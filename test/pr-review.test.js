const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const installer = require('../bin/pr-review-install.js');

const skillDir = path.join(__dirname, '..', 'skills', 'pr-review');
const cli = path.join(__dirname, '..', 'bin', 'pr-review-install.js');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function gitRepo() {
  const repo = tempDir('pr-review-repo-');
  execFileSync('git', ['init', '-q', repo]);
  return repo;
}

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'SKILL.md must start with a frontmatter block');
  return Object.fromEntries(
    match[1].split('\n').map((line) => {
      const at = line.indexOf(':');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
}

test('the skill is named after its folder and runs only from the slash command', () => {
  const meta = frontmatter(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'));
  assert.equal(meta.name, 'pr-review');
  assert.equal(meta['disable-model-invocation'], 'true');
  assert.ok(meta.description.length > 40, 'description must say what the skill does');
});

test('installer always targets the current repository', () => {
  assert.equal(installer.destination('/repo'), path.join('/repo', '.claude', 'skills', 'pr-review'));
  assert.throws(() => installer.parse(['--global']), /repository-local/);
  assert.throws(() => installer.parse(['--project']), /repository-local/);
  assert.throws(() => installer.parse(['--yes']), /Unknown argument: --yes/);
});

test('installs the skill files unchanged into the repository', () => {
  const repo = gitRepo();
  const target = installer.install({ force: false, dryRun: false }, repo);
  assert.equal(target, path.join(repo, '.claude', 'skills', 'pr-review'));
  assert.equal(
    fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'),
  );
});

test('refuses to overwrite an existing installation without --force', () => {
  const repo = gitRepo();
  const target = installer.install({ force: false, dryRun: false }, repo);
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'local edits');
  assert.throws(() => installer.install({ force: false, dryRun: false }, repo), /Use --force/);
  assert.equal(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'local edits');
});

test('--force replaces the old installation, including files the new one no longer ships', () => {
  const repo = gitRepo();
  const target = installer.install({ force: false, dryRun: false }, repo);
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'old version');
  fs.writeFileSync(path.join(target, 'removed-in-new-version.md'), 'stale');
  installer.install({ force: true, dryRun: false }, repo);
  assert.equal(
    fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'),
  );
  assert.equal(fs.existsSync(path.join(target, 'removed-in-new-version.md')), false);
});

test('--dry-run reports the destination without writing anything', () => {
  const repo = gitRepo();
  const target = installer.install({ force: false, dryRun: true }, repo);
  assert.equal(target, path.join(repo, '.claude', 'skills', 'pr-review'));
  assert.equal(fs.existsSync(path.join(repo, '.claude')), false);
});

test('the command fails with guidance outside a Git repository', () => {
  const dir = tempDir('pr-review-plain-');
  const result = spawnSync(process.execPath, [cli, 'install'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /inside the Git repository/);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
});
