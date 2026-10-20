# PR Review for Claude Code

PR Review reads a pull request and tells you, in the Claude Code chat, what is wrong with it and how much each problem matters. It never posts anything to GitHub — the findings are yours to share or discard.

Every problem it finds is rated two ways:

- **Blast radius** — how much damage it could do:
  - **Critical** — wrong data that looks right, data loss, a security hole, or the main flow broken. Blocks merge.
  - **Medium** — a narrower path goes wrong, something crashes loudly, or users would notice a regression.
  - **Low** — no visible effect today: naming, duplication, file size, tidiness. Never blocks.
- **Effort to fix** — **Low** (a few lines), **Medium** (several files or a small decision), **High** (a redesign, a migration, or a question for the product owner).

The worst problems come first, and among equals, the cheapest fixes come first.

It also checks the PR against what was asked for (the linked issue, the PR description, or a spec doc), and it is strict about tests: a test that would still pass if the code were broken counts as no test at all.

## Add PR Review to a project

Run this from the root of the project where you want to use it:

```sh
npx --yes --package=github:aahadaazar-nextgeni/pr-review-skill pr-review-skill install
```

Then start Claude Code in that project and run:

```text
/pr-review
```

The skill is added only to that project at `.claude/skills/pr-review`. There is no npm subscription or npm account required.

### Share or install manually

You can also copy the `skills/pr-review` folder from this repository into a project:

```text
your-project/
└── .claude/
    └── skills/
        └── pr-review/
            └── SKILL.md
```

## Update PR Review

If PR Review is already installed in a project, run the same installer with `--force` from that project's root:

```sh
npx --yes --package=github:aahadaazar-nextgeni/pr-review-skill#main pr-review-skill install --force
```

The updated skill replaces the old files in `.claude/skills/pr-review`. Restart Claude Code afterward so it loads the new version. Your project's `.pr-review.md` is not changed.

## Everyday commands

### Review the pull request for your current branch

```text
/pr-review
```

If the branch has one open pull request, it reviews that one. If it has several, Claude asks which one. If it has none, Claude offers to review the branch's changes against its base instead.

### Review a specific pull request

```text
/pr-review 467
/pr-review https://github.com/your-org/your-repo/pull/467
/pr-review some-branch
```

### Do a thorough review

```text
/pr-review 467 --deep
```

Use this for changes where a mistake is expensive — money, data, migrations, permissions. Instead of stopping at the five most important problems, it lists everything, and checks each one against the code that actually produces the data before reporting it. Each finding is marked **CONFIRMED** (traced end to end) or **PLAUSIBLE** (depends on something it couldn't check, and it says what).

PR Review only runs when you type `/pr-review`. Claude won't start it on its own.

## What a review looks like

```text
PR #467 — Invoice totals double-count discount rows
https://github.com/your-org/your-repo/pull/467
main ← fix/invoice-discounts · 6 files, +142/-38 · CI passing
Spec: #451
Critical 1 · Medium 1 · Low 0

FINDINGS

1. [Critical · effort Low] src/invoices/total.ts:58 — expired discounts are
   still subtracted from the total. An invoice with one expired 100 discount
   shows 100 less than the issue's worked example.
   Spec: "Expired discounts are ignored."
   Skip expired rows before subtracting, and add a test using the issue's example.

2. [Medium · effort Low] src/invoices/total.test.ts:12 — the only test for
   discounts takes its expected value from calculateTotal itself, so it
   passes even when the total is wrong.
   Replace the expected value with the number from the issue's worked example.

QUESTIONS

1. Should a discount larger than the invoice bring the total below zero, or
   stop at zero? The code allows a negative total and nothing in the issue says
   which is right.

SUMMARY

Fixes the double-counted discount rows the issue describes, but expired
discounts still reduce the total. Not mergeable until finding 1 is fixed.

Nothing was posted to GitHub.
```

When there is no issue or spec to compare against, PR Review works out what the code seems to be for, says so, and asks a few questions about how it should behave instead of guessing.

## Make PR Review match your project

PR Review reads your project's own instructions first — `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, or `CODING_STANDARDS.md` — and they take priority over its defaults.

For rules that are only about reviews, add a `.pr-review.md` file at the root of your project. Write it in plain language; there is no fixed format. Commit it so everyone's reviews follow the same rules. A useful one usually covers:

```markdown
# PR review rules

## Where specs live
Linear tickets. The key (ABC-123) is in the PR title. The acceptance list is the spec.

## Critical paths
Anything touching invoices, payments, or the `billing/` folder is Critical when wrong.

## Commands
- Never run `npm run build` — it takes too long and uses too much memory.
- To check types, run `npx tsc --noEmit`. To run one test file, use `npx vitest run <file>`.

## How the parts depend on each other
`api/` decides what data looks like; `web/` only displays it. When a web change assumes
something about the API's output, read the API code to check it.

## Team rules
- One purpose per PR.
- No test may call the real payment provider.
```

## What you need

- Claude Code
- Git
- GitHub CLI (`gh`), signed in — used to read pull requests, comments, and CI status
- Node.js 18 or newer, for the installer only

## For maintainers

Run the automated tests from this repository:

```sh
npm test
```

The package is distributed from GitHub rather than the npm registry.
