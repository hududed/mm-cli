import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { findProjectRoot, getSkillsDir } from '../util/fs.js';
import { table } from '../util/format.js';
import { listSkills } from '../skill/manager.js';
import { validateSkill, validateAllSkills } from '../skill/validator.js';
import { exportSkills, getOutputFilename, type ExportFormat } from '../skill/exporter.js';
import { ClaudeClient } from '../engine/claude-client.js';
import { StdinIO } from '../engine/stdin-io.js';
import { runInterview } from '../engine/interview.js';
import { SKILL_BUILD, SKILL_BUILD_EXAMPLES, SKILL_BACKLOG, SKILL_AUDIT } from '../engine/interview-templates.js';
import { loadConfig, getApiKey, DEFAULT_MODEL } from '../util/config.js';

function requireProjectRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    console.error(chalk.red('Not in a project directory (no .git, package.json, or CLAUDE.md found)'));
    process.exit(1);
  }
  return root;
}

export function registerSkill(program: Command): void {
  const skill = program
    .command('skill')
    .description('Manage skills (.claude/skills/)');

  skill
    .command('new <name>')
    .description('Interview-driven skill creation — explores your codebase and builds a SKILL.md')
    .option('--model <model>', 'Override Claude model')
    .option('--dry-run', 'Print messages without calling API')
    .option('--fresh', 'Start from scratch even if skill already exists')
    .option('--from-examples', 'Extract methodology from 3–5 examples of your best work instead of codebase exploration')
    .action(async (name: string, opts) => {
      const root = requireProjectRoot();
      const skillDir = join(getSkillsDir(root), name);
      const skillPath = join(skillDir, 'SKILL.md');

      // Check if skill already exists (unless --fresh)
      if (existsSync(skillPath) && !opts.fresh) {
        console.log(chalk.dim(`Skill "${name}" already exists — entering edit mode.`));
        console.log(chalk.dim('Use --fresh to start from scratch.\n'));
      }

      // Ensure skill directory exists
      mkdirSync(skillDir, { recursive: true });

      // Write tile.json if it doesn't exist
      const tilePath = join(skillDir, 'tile.json');
      if (!existsSync(tilePath)) {
        const tile = {
          name,
          version: '1.0.0',
          description: '',
          triggers: [name],
          skill_file: 'SKILL.md',
          eval_suite: null,
        };
        writeFileSync(tilePath, JSON.stringify(tile, null, 2), 'utf-8');
      }

      const config = loadConfig();
      const apiKey = opts.dryRun ? 'dry-run' : getApiKey(config);
      const client = new ClaudeClient({
        apiKey,
        model: opts.model || config.model || DEFAULT_MODEL,
      });

      const io = new StdinIO();

      const template = opts.fromExamples ? SKILL_BUILD_EXAMPLES : SKILL_BUILD;
      const initialInput = opts.fromExamples
        ? `The skill name is "${name}". Ask me for examples — do not explore the codebase.`
        : `The skill name is "${name}". Explore the codebase and build a SKILL.md for this domain.`;

      try {
        const result = await runInterview(template, client, io, {
          dryRun: opts.dryRun,
          outputFile: skillPath,
          fresh: opts.fresh,
          initialInput,
        });

        if (result.artifact) {
          console.log(chalk.green(`\n✓ Created skill "${name}"`));
          console.log(chalk.dim(`  ${skillPath}`));
          console.log(chalk.dim(`  ${tilePath}`));
          console.log(`\nRun ${chalk.cyan('mm skill validate ' + name)} to check it, or ${chalk.cyan('mm eval new ' + name)} to build evals.`);
        }
      } catch (err: any) {
        console.error(chalk.red(`\n✗ ${err.message}`));
        process.exit(1);
      } finally {
        io.close();
      }
    });

  skill
    .command('list')
    .description('List all skills in the current project')
    .action(() => {
      const root = requireProjectRoot();
      const skills = listSkills(root);

      if (skills.length === 0) {
        console.log(chalk.dim('No skills found. Create one with: mm skill new <name>'));
        return;
      }

      const rows = skills.map(s => [
        s.name,
        s.version || '-',
        s.hasSkillMd ? chalk.green('✓') : chalk.red('✗'),
        s.hasTileJson ? chalk.green('✓') : chalk.red('✗'),
        (s.triggers || []).join(', ') || '-',
      ]);

      console.log(table(
        ['Name', 'Version', 'SKILL.md', 'tile.json', 'Triggers'],
        rows,
      ));
    });

  skill
    .command('validate [name]')
    .description('Validate skill structure and content')
    .action((name?: string) => {
      const root = requireProjectRoot();

      if (name) {
        const issues = validateSkill(root, name);
        printValidationResults(name, issues);
      } else {
        const allResults = validateAllSkills(root);
        if (allResults.size === 0) {
          console.log(chalk.dim('No skills found. Create one with: mm skill new <name>'));
          return;
        }
        for (const [skillName, issues] of allResults) {
          printValidationResults(skillName, issues);
        }
      }
    });

  skill
    .command('export')
    .description('Export skills to other formats (cursor, windsurf)')
    .option('--format <format>', 'Output format: cursor, windsurf, merged', 'cursor')
    .action((opts) => {
      const root = requireProjectRoot();
      const format = opts.format as ExportFormat;

      try {
        const output = exportSkills(root, format);
        const filename = getOutputFilename(format);
        writeFileSync(join(root, filename), output, 'utf-8');
        console.log(chalk.green(`✓ Exported to ${filename}`));
      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`));
        process.exit(1);
      }
    });

  skill
    .command('backlog')
    .description('Interview-driven skill backlog — surfaces recurring AI workflows and writes a prioritized BACKLOG.md')
    .option('--model <model>', 'Override Claude model')
    .option('--dry-run', 'Print messages without calling API')
    .option('--fresh', 'Start from scratch even if BACKLOG.md already exists')
    .action(async (opts) => {
      const root = requireProjectRoot();
      const outputFile = join(root, '.claude', 'skills', 'BACKLOG.md');

      const config = loadConfig();
      const apiKey = opts.dryRun ? 'dry-run' : getApiKey(config);
      const client = new ClaudeClient({
        apiKey,
        model: opts.model || config.model || DEFAULT_MODEL,
      });

      const io = new StdinIO();

      // Inject existing skills so Claude can produce an "Already Built" section
      // and exclude covered workflows from the backlog table
      const existingSkills = listSkills(root);
      const existingSkillsContext = existingSkills.length > 0
        ? `The following skills are already built for this project:\n${existingSkills.map(s => `- ${s.name}`).join('\n')}\n\nExclude any workflows already covered by these skills from the backlog table. List them in an "Already Built" section above the table instead.`
        : 'No skills have been built for this project yet.';

      try {
        await runInterview(SKILL_BACKLOG, client, io, {
          dryRun: opts.dryRun,
          outputFile,
          fresh: opts.fresh,
          initialInput: existingSkillsContext,
        });
      } catch (err: any) {
        console.error(chalk.red(`\n✗ ${err.message}`));
        process.exit(1);
      } finally {
        io.close();
      }
    });

  skill
    .command('audit [name]')
    .description('Audit a skill against four agent-readiness criteria and produce a scored report')
    .option('--model <model>', 'Override Claude model')
    .option('--dry-run', 'Print messages without calling API')
    .option('--file <path>', 'Path to SKILL.md file (overrides name resolution)')
    .action(async (name: string | undefined, opts) => {
      const root = requireProjectRoot();

      let skillPath: string;
      if (opts.file) {
        skillPath = opts.file;
      } else if (name) {
        skillPath = join(root, '.claude', 'skills', name, 'SKILL.md');
      } else {
        console.error(chalk.red('Provide a skill name or --file <path>'));
        process.exit(1);
      }

      if (!existsSync(skillPath)) {
        const label = name || opts.file;
        console.error(chalk.red(`Skill "${label}" not found.`));
        const available = listSkills(root).map(s => s.name);
        if (available.length > 0) {
          console.log(chalk.dim('Available skills: ' + available.join(', ')));
        }
        process.exit(1);
      }

      const skillContent = readFileSync(skillPath, 'utf-8');
      const skillDir = join(skillPath, '..');
      const outputFile = join(skillDir, 'SKILL-audited.md');

      if (opts.dryRun) {
        console.log(chalk.dim(`Resolved skill file: ${skillPath}`));
      }

      const config = loadConfig();
      const apiKey = opts.dryRun ? 'dry-run' : getApiKey(config);
      const client = new ClaudeClient({
        apiKey,
        model: opts.model || config.model || DEFAULT_MODEL,
      });

      const io = new StdinIO();

      try {
        const result = await runInterview(SKILL_AUDIT, client, io, {
          dryRun: opts.dryRun,
          initialInput: skillContent,
          // No outputFile — we write the file ourselves based on result
        });

        const passed4of4 = result.artifact?.includes('4/4 criteria passing');
        if (passed4of4) {
          console.log(chalk.green('\n✓ 4/4 criteria passing — skill is production-ready. No action needed.'));
        } else if (result.artifact) {
          writeFileSync(outputFile, result.artifact, 'utf-8');
          console.log(chalk.yellow('\n⚠ Gaps found. Hardened skill saved to:'));
          console.log(chalk.dim(`  ${outputFile}`));
          console.log(chalk.dim(`\nReview the changes, then apply with:`));
          console.log(chalk.cyan(`  cp ${outputFile} ${skillPath}`));
          console.log(chalk.dim(`Then rerun: mm skill audit ${name || ''} to confirm 4/4.`));
        }
      } catch (err: any) {
        console.error(chalk.red(`\n✗ ${err.message}`));
        process.exit(1);
      } finally {
        io.close();
      }
    });
}

function printValidationResults(name: string, issues: { severity: string; message: string }[]): void {
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (issues.length === 0) {
    console.log(chalk.green(`✓ ${name}: all checks passed`));
    return;
  }

  console.log(chalk.bold(`\n${name}:`));
  for (const issue of errors) {
    console.log(chalk.red(`  ✗ ${issue.message}`));
  }
  for (const issue of warnings) {
    console.log(chalk.yellow(`  ⚠ ${issue.message}`));
  }

  if (errors.length === 0) {
    console.log(chalk.green(`  ✓ No errors (${warnings.length} warning${warnings.length !== 1 ? 's' : ''})`));
  } else {
    console.log(chalk.red(`  ${errors.length} error${errors.length !== 1 ? 's' : ''}, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`));
  }
}
