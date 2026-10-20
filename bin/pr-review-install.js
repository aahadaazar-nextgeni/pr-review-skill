#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const packageRoot = path.resolve(__dirname, '..');
const source = path.join(packageRoot, 'skills', 'pr-review');

function help() {
  console.log(`Install the PR Review Claude Code skill.

Usage:
  pr-review-skill install [--force] [--dry-run]

Options:
  --force      Replace an existing installation.
  --dry-run    Show the destination without changing files.
  --help       Show this help.
`);
}

function parse(argv) {
  const options = { force: false, dryRun: false };
  for (const arg of argv) {
    if (arg === 'install') continue;
    if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--global' || arg === '--project') {
      throw new Error('PR Review is repository-local; do not pass a global or project scope flag. Run this command from the repository root.');
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assertGitRepository(cwd) {
  try {
    execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { stdio: 'ignore' });
  } catch {
    throw new Error('Run the installer from inside the Git repository that should receive the PR Review skill.');
  }
}

function destination(cwd = process.cwd()) {
  return path.join(cwd, '.claude', 'skills', 'pr-review');
}

function install(options, cwd = process.cwd()) {
  assertGitRepository(cwd);
  const target = destination(cwd);
  if (options.dryRun) return target;
  if (fs.existsSync(target) && !options.force) {
    throw new Error(`Destination already exists: ${target}\nUse --force to replace it.`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  return target;
}

function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (options.help) return help();
  const target = install(options);
  if (options.dryRun) console.log(`Would install PR Review skill to ${target}`);
  else console.log(`Installed PR Review skill to ${target}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { destination, install, parse };
