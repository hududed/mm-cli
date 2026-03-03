import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = 'npx tsx src/index.ts';
const ROOT = join(__dirname, '..', '..');
const TEST_SKILL_DIR = join(ROOT, '.claude', 'skills', 'export-test');
const CURSORRULES = join(ROOT, '.cursorrules');

function createTestSkill(): void {
  mkdirSync(TEST_SKILL_DIR, { recursive: true });
  writeFileSync(join(TEST_SKILL_DIR, 'SKILL.md'), `---
name: export-test
version: 1.0.0
triggers:
  - "export"
---

# export-test Skill

## Role
You are an expert at export tasks.

## Instructions
Handle export tasks.

## Context
Test context.

## Output Format
Markdown.

## Guardrails
- Do not hallucinate

## Self-Improvement
Track results.
`, 'utf-8');
  writeFileSync(join(TEST_SKILL_DIR, 'tile.json'), JSON.stringify({
    name: 'export-test',
    version: '1.0.0',
    description: 'Export test skill',
    triggers: ['export'],
    skill_file: 'SKILL.md',
    eval_suite: null,
  }, null, 2), 'utf-8');
}

describe('mm skill export', () => {
  beforeEach(() => {
    if (existsSync(TEST_SKILL_DIR)) rmSync(TEST_SKILL_DIR, { recursive: true });
    if (existsSync(CURSORRULES)) rmSync(CURSORRULES);
    createTestSkill();
  });

  afterEach(() => {
    if (existsSync(TEST_SKILL_DIR)) rmSync(TEST_SKILL_DIR, { recursive: true });
    if (existsSync(CURSORRULES)) rmSync(CURSORRULES);
  });

  it('exports to .cursorrules format', () => {
    const output = execSync(`${CLI} skill export --format cursor`, { cwd: ROOT, encoding: 'utf-8' });
    expect(output).toContain('Exported to .cursorrules');
    expect(existsSync(CURSORRULES)).toBe(true);

    const content = readFileSync(CURSORRULES, 'utf-8');
    expect(content).toContain('Cursor Rules');
    expect(content).toContain('export-test');
  });
});
