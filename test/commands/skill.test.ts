import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = 'npx tsx src/index.ts';
const ROOT = join(__dirname, '..', '..');
const TEST_SKILL_DIR = join(ROOT, '.claude', 'skills', 'test-skill');

function createTestSkill(): void {
  mkdirSync(TEST_SKILL_DIR, { recursive: true });
  writeFileSync(join(TEST_SKILL_DIR, 'SKILL.md'), `---
name: test-skill
version: 1.0.0
triggers:
  - "test"
---

# test-skill Skill

## Role
You are an expert at test tasks.

## Instructions
Handle test tasks.

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
    name: 'test-skill',
    version: '1.0.0',
    description: 'Test skill',
    triggers: ['test'],
    skill_file: 'SKILL.md',
    eval_suite: null,
  }, null, 2), 'utf-8');
}

describe('mm skill', () => {
  beforeEach(() => {
    if (existsSync(TEST_SKILL_DIR)) {
      rmSync(TEST_SKILL_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_SKILL_DIR)) {
      rmSync(TEST_SKILL_DIR, { recursive: true });
    }
  });

  it('skill new --dry-run prints system prompt without API call', () => {
    const output = execSync(`${CLI} skill new test-skill --dry-run`, { cwd: ROOT, encoding: 'utf-8' });
    expect(output).toContain('DRY RUN');
    expect(output).toContain('skill architect');
    expect(output).toContain('SKILL.md');
    // Should create tile.json even in dry-run
    expect(existsSync(join(TEST_SKILL_DIR, 'tile.json'))).toBe(true);
  });

  it('skill list shows created skills', () => {
    createTestSkill();
    const output = execSync(`${CLI} skill list`, { cwd: ROOT, encoding: 'utf-8' });
    expect(output).toContain('test-skill');
  });

  it('skill validate reports on skill', () => {
    createTestSkill();
    const output = execSync(`${CLI} skill validate test-skill`, { cwd: ROOT, encoding: 'utf-8' });
    expect(output).toContain('test-skill');
  });

  it('skill validate runs on all skills without crashing', () => {
    createTestSkill();
    const output = execSync(`${CLI} skill validate`, { cwd: ROOT, encoding: 'utf-8' });
    expect(output).toContain('test-skill');
  });
});
