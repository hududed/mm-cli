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
 * A ``` line inside a top-level fence is treated as nested content, not a closer,
 * unless it's a bare ``` on its own line (matching the outer fence).
 *
 * Strategy: track depth. Opening fence = ```<lang> at depth 0 starts a block.
 * Bare ``` at depth 1 could be a nested closer or the outer closer —
 * we check if it's followed by more content that looks like it's still inside.
 * Simpler approach: the outer fence uses ```markdown (or ```), inner fences use
 * ```python, ```sql, etc. We close the outer block only when we see a bare ```
 * that is NOT immediately followed by a language tag on the same line.
 *
 * Actually simplest correct approach: count fence depth.
 */
function parseFencedBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let depth = 0;
  let currentBlock: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const isFenceOpen = /^```\w*\s*$/.test(trimmed) && trimmed !== '```';
    const isFenceClose = trimmed === '```';

    if (depth === 0) {
      if (isFenceOpen) {
        // Start a new top-level block
        depth = 1;
        currentBlock = [];
      } else if (isFenceClose) {
        // Bare ``` at depth 0 — also an opening fence (no lang tag)
        depth = 1;
        currentBlock = [];
      }
    } else if (depth === 1 && isFenceClose) {
      // Check if this close belongs to a nested fence or the outer fence.
      // If we have an unclosed nested fence, this closes the nested one.
      // Otherwise it closes the outer one.
      // Count nested opens vs closes within currentBlock to decide.
      const nestedOpens = currentBlock.filter(l => /^```\w+\s*$/.test(l.trim())).length;
      const nestedCloses = currentBlock.filter(l => l.trim() === '```').length;

      if (nestedOpens > nestedCloses) {
        // This ``` closes a nested fence, not the outer one
        currentBlock.push(line);
      } else {
        // This closes the outer fence
        blocks.push(currentBlock.join('\n'));
        depth = 0;
        currentBlock = [];
      }
    } else if (depth >= 1) {
      currentBlock.push(line);
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

  const extracted = extractArtifact(content);
  writeFileSync(filePath, extracted, 'utf-8');
  console.log(chalk.green(`\n✓ Saved to ${filePath}`));
}
