import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import chalk from 'chalk';

/**
 * Extract the artifact content from a response that may contain commentary
 * and code fences. When Claude wraps a SKILL.md or other artifact in a
 * code fence (```markdown ... ```), we want just the inner content.
 *
 * Handles nested code fences (e.g. SKILL.md containing ```python blocks)
 * by parsing line-by-line and tracking fence depth.
 */
export function extractArtifact(response: string): string {
  const blocks = parseFencedBlocks(response);

  if (blocks.length === 0) return response;

  // Find the block that looks most like a complete artifact:
  // prefer blocks with YAML frontmatter (---), then longest block
  const withFrontmatter = blocks.filter(b => b.trimStart().startsWith('---'));
  if (withFrontmatter.length > 0) {
    return withFrontmatter.reduce((a, b) => a.length > b.length ? a : b).trim() + '\n';
  }

  // No frontmatter blocks — return the longest fenced block
  const longest = blocks.reduce((a, b) => a.length > b.length ? a : b);
  if (longest.split('\n').length > 20) {
    return longest.trim() + '\n';
  }

  return response;
}

/**
 * Parse top-level fenced code blocks, correctly handling nested fences.
 *
 * Strategy: track fence depth properly. Every ``` (with or without lang tag)
 * toggles depth. The outer fence opens at depth 0→1. Inner fences toggle
 * between 1→2 and 2→1. Only when depth goes from 1→0 do we close the
 * outer block.
 *
 * This handles:
 * - ```markdown wrapping with ```python/```sql nested inside (tagged fences)
 * - ```markdown wrapping with bare ``` blocks nested inside (untagged fences)
 * - Mixed tagged and untagged nested fences
 */
function parseFencedBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let depth = 0;
  let currentBlock: string[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();
    const isFence = /^```\w*\s*$/.test(trimmed); // matches ```lang or bare ```

    if (!isFence) {
      if (depth >= 1) {
        currentBlock.push(line);
      }
      continue;
    }

    // It's a fence line
    if (depth === 0) {
      // Opening a new top-level block
      depth = 1;
      currentBlock = [];
    } else if (depth === 1) {
      // Could be opening a nested fence or closing the outer one.
      const isTaggedOpen = trimmed !== '```';
      if (isTaggedOpen) {
        // ```python, ```bash, etc. — always a nested open
        depth = 2;
        currentBlock.push(line);
      } else {
        // Bare ``` — could close outer or open a nested bare block.
        // Look ahead for another bare ``` that would close this one.
        const remaining = lines.slice(idx + 1);
        let foundMatchingClose = false;
        let lookAheadDepth = 0;
        for (const ahead of remaining) {
          const aheadTrimmed = ahead.trim();
          if (/^```\w+\s*$/.test(aheadTrimmed)) {
            lookAheadDepth++;
          } else if (aheadTrimmed === '```') {
            if (lookAheadDepth > 0) {
              lookAheadDepth--;
            } else {
              foundMatchingClose = true;
              break;
            }
          }
        }
        if (foundMatchingClose) {
          // This bare ``` opens a nested block, the matching one closes it
          depth = 2;
          currentBlock.push(line);
        } else {
          // No matching close ahead — this closes the outer fence
          blocks.push(currentBlock.join('\n'));
          depth = 0;
          currentBlock = [];
        }
      }
    } else {
      // depth >= 2 — inside nested fence
      currentBlock.push(line);
      if (trimmed === '```') {
        depth--;
      } else {
        // ```lang inside nested — deeper nesting
        depth++;
      }
    }
  }

  // If we ended mid-block (unclosed fence), still capture it
  if (depth > 0 && currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks;
}

export function writeArtifact(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  let extracted = extractArtifact(content);

  // For YAML files, strip trailing non-YAML commentary (e.g. "COMPLETENESS CHECK: ...")
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    extracted = stripYamlTrailingCommentary(extracted);
  }

  writeFileSync(filePath, extracted, 'utf-8');
  console.log(chalk.green(`\n✓ Saved to ${filePath}`));
}

/**
 * Strip trailing non-YAML content from a YAML artifact.
 * Claude often adds commentary after the YAML (e.g. "COMPLETENESS CHECK: ...")
 * which breaks yaml.parse(). We find the last valid YAML line and truncate.
 */
function stripYamlTrailingCommentary(content: string): string {
  const lines = content.split('\n');

  // Walk backwards from the end, skip blank lines and find the first
  // line that looks like non-YAML commentary (starts with *, #, or uppercase words followed by :)
  let lastYamlLine = lines.length - 1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue; // skip blank lines

    // These patterns indicate post-YAML commentary, not YAML content:
    // - Markdown bold: **text**
    // - Markdown headers: ## text
    // - Bare text sentences (no YAML indentation/structure)
    if (
      trimmed.startsWith('**') ||
      trimmed.startsWith('##') ||
      trimmed.startsWith('Your eval') ||
      trimmed.startsWith('COMPLETENESS') ||
      trimmed.startsWith('Run it with')
    ) {
      lastYamlLine = i - 1;
    } else {
      break;
    }
  }

  // Trim trailing blank lines
  while (lastYamlLine > 0 && !lines[lastYamlLine].trim()) {
    lastYamlLine--;
  }

  return lines.slice(0, lastYamlLine + 1).join('\n') + '\n';
}
