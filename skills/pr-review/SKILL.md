---
name: pr-review
disable-model-invocation: true
description: "Review a pull request and report findings in chat, never on GitHub. Each finding is rated by blast radius (Critical / Medium / Low) and effort to fix. Checks the change and its tests against the originating spec (issue, PR body, docs), and treats tautological tests as no coverage. Default mode is a concise pass; --deep verifies every finding against the code that produces it."
---

# PR Review

Review a pull request and report findings **in chat**. Two modes: a concise default
reviewer, and `--deep` for adversarial multi-round review.

**This skill never writes to GitHub.** No inline comments, no review submission, no
summary posted to the PR — not on request inside the skill, not as a final step. The
output is text in the conversation, and publishing any of it is the user's own action.
If the user asks for findings posted, say that this skill doesn't do that and let them
use `gh` themselves.

---

## 0. Read the project's rules

Before anything else, read whichever of these exist at the repository root:

- `.pr-review.md` — this skill's project rules: where specs live, critical paths, commands
  that are safe or forbidden, team rules, and how the repository's parts depend on each
  other
- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `CODING_STANDARDS.md`

What they say overrides the defaults in this file. In particular, never run a command
the project forbids. When nothing says otherwise, never run a full production build
just to verify something; use a type check, a linter, or a targeted test run instead,
and ask before anything long-running.

---

## 1. Resolve the target

Accept any of these, in this order of preference:

| Input | Resolution |
|---|---|
| `/pr-review 467` | PR number in the current repository |
| `/pr-review https://github.com/<org>/<repo>/pull/467` | PR URL (also `/changes`, `/files` suffixes) |
| `/pr-review some-branch` | The open PR whose head is that branch |
| `/pr-review` (no target) | The open PR for the **current branch** — see below |

Once a single PR is settled on:

```bash
gh pr view <number> --json number,title,url,state,isDraft,author,baseRefName,headRefName,body,additions,deletions,changedFiles
```

If `gh` is unauthenticated, stop and say so.

### No target given

Find every open PR whose head is the current branch. A branch can have more than one —
the same work retargeted at a different base, or an integration PR sitting beside the
branch's own.

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
gh pr list --head "$BRANCH" --state open \
  --json number,title,url,baseRefName,isDraft,updatedAt,author \
  --jq 'sort_by(.updatedAt) | reverse'
```

Then, by how many came back:

**Exactly one** — review it. Name it in one line before starting (number, title, base),
so the user can stop you if it's the wrong one. Don't ask; there's nothing to choose
between.

**More than one** — **ask, using the `AskUserQuestion` tool** so the choice renders as
selectable options rather than a question buried in prose. One question, header
`"Which PR"`, `multiSelect: false`. Each option is one PR:

- **label** — `#<number> <short title>`, trimmed to stay readable
- **description** — `<base> ← <head> · updated <relative time> · <draft|ready>`, plus
  anything that distinguishes it (a different base is usually the real difference)

Order by most recently updated, and put that one first. The tool caps options at four:
if the branch has more than four open PRs, list them all as text first, offer the four
most recent as options, and say in the question that the rest can be reached through
"Other". Never guess — picking the wrong PR wastes a whole review and, in `--deep` mode,
a lot of it.

**None** — say the branch has no open PR, then ask whether to review the branch's diff
against its base instead:

```bash
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
BASE=$(git merge-base HEAD "origin/$DEFAULT")   # or the base the branch was cut from
git diff "$BASE"...HEAD
```

Don't silently review something the user didn't point at. If the branch has no upstream
at all, or matches the repository's default branch, say that plainly — there is no
review to do yet.

---

## 2. Gather the material

```bash
gh pr diff <number>                                    # the diff under review
gh pr view <number> --json comments,reviews            # existing discussion
gh api repos/{owner}/{repo}/pulls/<number>/comments    # inline review comments
gh pr checks <number>                                  # CI state
```

Read the existing discussion **before** forming findings. Feedback already given —
by a human or by an earlier run of this skill — is not yours to repeat.

If the PR has been updated since a previous review in this conversation, diff only what
is new:

```bash
gh pr view <number> --json commits --jq '.commits[-3:] | .[] | .oid + " " + .messageHeadline'
git diff <last-reviewed-sha>..<head-sha>
```

### Find the spec

The code and its tests are judged against what was asked for, so find that before
forming findings. Use the project rules' spec sources first when they name any.
Otherwise look in this order:

1. **Issue references** in the PR title, body, or commit messages — tracker keys such as
   `ABC-123`, or GitHub's `#123` / `Closes #45`. Read GitHub issues with
   `gh issue view`, and other trackers through their CLI or MCP server when one is
   connected. When none is, say the issue couldn't be fetched and carry on with the next
   sources. Don't stop the review over it.
2. **The PR body.**
3. **A doc** under `docs/`, `specs/`, or similar that matches the branch or feature name.
4. **Nothing found** → there's no spec. Say so in the header and work from the code's
   own intent (§3, *When there is no spec*).

When an issue describes product behaviour rather than code, turn each acceptance line
into the behaviour the code must show. Quote the line whenever a finding rests on it.

---

## 3. Review focus

1. **Spec conformance** — see below
2. **Test coverage** — real tests for new or modified code, critical paths first; see
   *Tests* below
3. **Code quality** — SOLID, maintainability
4. **Typing** — proper types; no `any` in TypeScript, no untyped escape hatches
5. **Security** — potential vulnerabilities
6. **Framework patterns** — e.g. in React, declarative code and no cascading `useEffect`
7. **Performance** — any significant regression
8. **Code patterns** — magic strings, duplicated types, needlessly complex logic

When the repository has several parts that depend on each other — frontend and backend,
service and worker, app and engine — a change in one whose correctness depends on
another is the highest-value thing to check. See §6.

Skip anything a tool already enforces (the type checker, the linter, formatters, and any
checks the project rules list). A documented project rule always overrides a general
heuristic from this file.

### Spec conformance

With a spec in hand, check three things and quote the spec line for each finding:

- **Asked for, but missing or partial** — an acceptance line with no code behind it, or
  code that handles only part of it.
- **Built, but not asked for** — behaviour the spec didn't request. It's scope creep, and
  usually also a *single purpose* miss.
- **Looks implemented, but wrong** — the code addresses the requirement and gets it
  wrong.

### Tests — checked against the spec, not against the code

A test proves something only if it fails when the behaviour breaks. Check every new or
changed test for that, strictly. **A tautological test counts as no test**: report the
behaviour as untested, and name the test that only appears to cover it.

Signs of a tautological test:

- **Mock echo** — a dependency is stubbed to return X and the test asserts the unit
  returns X, with none of the unit's own logic in between.
- **Expected value taken from the code under test** — the expected value comes from
  calling the same function, or from a copy of its formula
  (`expect(total(rows)).toBe(rows.reduce(…))` when `total` *is* that reduce).
- **Self-blessed fixtures** — a snapshot, golden file, or expected-output fixture
  captured from the new code's own output and committed with it, with nothing tying the
  values back to the spec.
- **Existence-only assertions** — `toBeDefined`, `toBeTruthy`, `is not None`,
  `toHaveBeenCalled()` when the behaviour is the value or the arguments.
- **Assertions that never run** — un-awaited async, an assertion inside a loop over an
  empty list, a `catch`/`except` that swallows the failure, `rejects` without checking
  which error.
- **Testing the how** — asserting call order, private state, or internal steps instead
  of the outcome. These fail on a refactor and pass on a bug.
- **The name promises more than the body checks** — `test_rejects_negative_qty` that
  never passes a negative quantity.

The check that settles it: mentally break the line under test. Flip the condition, drop
a row, return early, swap the sign. If no test goes red, the coverage isn't there. In
`--deep`, when the behaviour is Critical-tier (§4), prove it: run the test against the
base branch's source in a scratch worktree with a targeted test command (never a build)
and confirm it fails there.

Tests must come from the spec:

- Each acceptance line or requirement maps to at least one test. Its expected values
  come from the spec, or are worked out by hand, never from running the code. Name the
  requirements that have no test.
- A test that asserts behaviour the spec contradicts locks the bug in. Rate it at the
  tier of that behaviour.
- No test may call a real external service the project doesn't own: an LLM, a payment
  provider, a third-party API. Every such call a test can reach must be stubbed; a test
  whose result depends on whether credentials exist is a defect.

**When there is no spec**, work out the intended behaviour from the code: names,
callers, the PR description, commit messages. State that reading in one line as an
assumption and judge the tests against it. Where the reading is uncertain, don't raise a
finding on a guess. Ask instead: up to three questions in a `QUESTIONS` section, phrased
neutrally and about behaviour, not about the author's choices:

- "What should happen when an order line has a quantity of zero — drop it, or keep it
  with a zero total?"
- not "Why didn't you handle zero quantities?"

Questions are only for intent the code can't answer. Anything the code can answer, look
up.

### Team rules

These are the defaults. The project rules may replace or extend them.

- **Single purpose** — the PR solves one problem
- **PR name** — names the bug or the problem, not the solution
- **Testing** — good coverage on new code, critical paths prioritised
- **Self-documenting code** — clear names over doc comments that restate the code
- **File size** — under ~300 lines; suggest a split when exceeded

### Patterns worth flagging

**Complex conditionals** — nested or inverted logic that an early return would flatten.
`if (!client) return null` over `if (client) { … } else { return null }`.

**Missing error handling** — async work with no `try`/`catch`, promises with no rejection
path, tests that only cover the happy path. Ask how the error case is handled rather than
asserting it's broken.

**String formatting** — long `+` concatenations, multi-line strings without template
literals or f-strings.

### Smells — judgement calls, never hard violations

Adapted from Fowler's catalogue. Label each one "possible <smell>". A smell rates Low
unless it has already caused a defect: duplicated logic where only one copy got the fix
is a bug, rated at that bug's tier.

- **Duplicated Code** — the same logic shape in two hunks or files → extract it once.
- **Shotgun Surgery** — one logical change scattered across many files → gather it into
  one module.
- **Divergent Change** — one file edited for several unrelated reasons → split it.
- **Speculative Generality** — parameters, hooks, or abstraction the spec doesn't need →
  inline it until a real need shows.
- **Primitive Obsession** — a string or number standing in for a domain concept → give
  the concept its own type.
- **Repeated Switches** — the same `switch`/`if` cascade on the same value in several
  places → one shared map.
- **Feature Envy** — a function that reaches into another module's data more than its
  own → move it next to that data.
- **Mysterious Name** — a name that doesn't say what it holds or does → rename it. If no
  honest name comes, the design is murky.

---

## 4. Rating each finding

Every finding carries two ratings.

### Blast radius — what breaks, for whom, and whether anyone notices

| Tier | Means | Examples |
|---|---|---|
| **Critical** | Wrong data that looks right, data loss, a security hole, or the main flow broken for every user. Blocks merge. | an invoice total that counts a subtotal row twice; a migration that drops a column something still reads; a permission check that can be bypassed; one customer's data visible to another |
| **Medium** | Wrong behaviour on a reachable but narrower path, a loud failure (crash, 500, stuck job), or a regression users would notice. Fix before merge, or a follow-up the author agrees to. | a swallowed error that stops a job from resuming; a page that 500s on one file type; an N+1 query on a list page |
| **Low** | No user-visible effect today: maintainability, naming, duplication, a team-rule miss, a smell. Never blocks. | a 400-line file; a magic string; possible Feature Envy |

Silent beats loud: a wrong number nobody notices outranks a crash everyone sees.

A test gap is rated by what the untested code guards. No real test on a money, data
integrity, migration, auth, or permissions path — or on a critical path the project
rules name — is **Medium**; elsewhere it's **Low**. When a defect sits in the same place,
it's one finding at the defect's tier, not two.

### Effort to fix — what closing it costs the author

| Effort | Means |
|---|---|
| **Low** | A few lines in one place; the fix is obvious from the finding. |
| **Medium** | Several files, a new test fixture, or a small decision the author has to make. |
| **High** | A design change, a migration, a change to a contract between parts of the system, or a product question for someone outside the PR. |

Order findings by blast radius, then by effort, lowest first, so a Critical that's a
two-line fix sits at the top. Effort never lowers a tier. A Critical with High effort is
still Critical: say plainly that the fix is large, so the team can decide whether to
split it out. That decision is theirs, not the reviewer's.

---

## 5. Default mode

One pass over the diff against §3, rated per §4.

**Output contract:**

- At most **5** findings, highest blast radius first. A Low finding makes the cut only
  if there's room and it's high-signal.
- Each finding carries its blast radius and effort.
- Up to 3 questions when the spec is missing or ambiguous. They don't count toward the 5.
- A 2–3 sentence summary
- Nothing already said on the PR
- **If the code is good, say so in one line and stop.** Padding a clean PR with nits is
  a failure of this skill, not a courtesy.

Each finding names the file and line as a clickable reference, states the defect in one
sentence, and gives a concrete failure scenario — inputs or state, and the wrong result
they produce. A finding you cannot write a failure scenario for is a preference, not a
bug; drop it or label it explicitly as a nit.

---

## 6. Deep mode (`--deep`)

For PRs where a wrong answer is expensive — money, data integrity, migrations, auth,
anything the team has been burned by before. No 5-finding cap.

### Round 1 — candidates

Sweep the diff for candidate findings. Be liberal here; nothing is reported yet. Trace
each spec requirement to the code that implements it and to the test that proves it, and
audit every new or changed test against §3 *Tests*.

### Round 2 — verify each candidate

This is the round that earns the mode. For every candidate, go to the code that
**produces** the condition, not just the code that consumes it:

- A guard on a value → find every site that emits that value. Does the case the guard
  handles ever actually occur?
- A branch keyed on a status, cause, or enum → find the producer's full range. Is the
  branch reachable? Is a case missing?
- An assumption about another component's output → read that component. The part that
  produces the data decides what shapes exist; the parts that consume it only react.

**A PR's own tests are not evidence of reachability.** Hand-built fixtures encode what
the author assumed the system produces, not what it does produce. Treat a finding as
verified only when you have read the producing code.

Mark each survivor `CONFIRMED` (you traced it end to end) or `PLAUSIBLE` (it depends on
something you could not verify — say what).

### Round 3 — rate, rank, and report

Rate each survivor per §4 and order by blast radius, then effort — not by how clever the
finding is. For each, state whether it blocks merge in your read, and say plainly when
the answer is "mergeable with a follow-up."

Thin test coverage on a specific case often points at the same place a real defect
lives. When round 1 flags coverage and round 2 finds a bug nearby, say they're the same
finding.

---

## 7. Output format

```text
PR #<number> — <title>
<url>
<base> ← <head> · <changedFiles> files, +<additions>/-<deletions> · CI <state>
Spec: <issue key | PR body | docs/<file>.md | none found — reviewed against the code's own intent>
Critical <n> · Medium <n> · Low <n>

FINDINGS

1. [Critical · effort Low] <file.ts:42> — <one-sentence defect>   [CONFIRMED | PLAUSIBLE]
   <Concrete failure scenario: inputs/state → wrong result.>
   <The spec line it rests on, quoted, when there is one.>
   <What would close it.>

2. …

QUESTIONS

1. <Neutral question about intended behaviour, and what the answer decides.>

SUMMARY

<2–3 sentences: what the PR does, whether it does what the spec asked, whether it's
mergeable, and the one thing to fix first.>
```

Omit the `[CONFIRMED | PLAUSIBLE]` tag in default mode — it's meaningful only when a
verify round actually ran.

On a clean PR, drop `FINDINGS` and the tier count, and give the summary alone. Omit
`QUESTIONS` when there are none.

End with a single line noting that nothing was posted to GitHub, so the user knows the
findings are theirs to publish or discard.

---

## 8. What not to do

- Don't post to GitHub. Ever. See the top of this file.
- Don't repeat feedback already on the PR.
- Don't report a finding you couldn't construct a failure scenario for.
- Don't review unchanged code, unless it's the producer that a changed line depends on.
- Don't run a build, or any command the project rules forbid.
- Don't count a tautological test as coverage.
- Don't flag what a tool already enforces.
- Don't raise a finding on a guessed intent. Ask instead.
- Don't let effort lower a blast-radius tier.
- Don't soften a real finding into a question to seem agreeable, and don't inflate a nit
  into a blocker to seem thorough.
