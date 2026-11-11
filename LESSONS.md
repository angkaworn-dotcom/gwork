# LESSONS — field failures that made the kit better

Append-only, newest first. Every entry = a bug the kit hit in a real repo, fixed at the source per the Self-repair protocol in [SKILL.md](SKILL.md). Read the two most recent entries before an install — they are the freshest sharp edges.

Format: `## L-xxx — <one-line symptom>` · date · repo · Root cause · Fix · Harness.

## L-010 — a raw NUL byte made the checker a binary file; the fix sat uncommitted in an installed skill clone

- **Date:** 2026-10-27 (found in a field install) · upstreamed 2026-11-11
- **Symptom:** `grep` printed nothing for patterns that exist in `scripts/tasklog-check.mjs`, and `git diff` on it said "Binary files differ" — a reviewer could not read changes to the checker.
- **Root cause:** `ruleKey` joined path and pattern with a literal NUL byte inside a template literal. JavaScript accepts it; git and grep classify any file containing a NUL as binary.
- **Fix:** the separator is written as the `\u0000` escape — same runtime value, plain-text file. **Second lesson:** this fix, its lesson, and an earlier note about the executable bit (now L-006) had been written into the installed skill clone and never committed, so the kit shipped the defect for two more weeks. `gwork-drift.mjs` now also reports uncommitted files in the kit itself.
- **Harness:** `node e2e/tools/unit.mjs` 91/91 · `git diff --stat` shows line counts for the checker again.

## L-009 — measured: in a real session the gotcha hook delivered nothing, and one injection overflowed the context cap

- **Date:** 2026-11-11 · **Repo:** a copy of a real task-log (several hundred entries), replayed offline
- **Symptom:** replaying the files of the last 40 commits as one session produced **0** injections. Across all tracked source files, 53% got an injection, but it was the same one or two catch-all rows; the largest single injection was 13,259 characters, over the harness's 10,000 cap.
- **Root cause:** lookup was by module name only, and the INDEX was filed under topic names (L-008). The injection printed whole entry cells, and one row carried 8,000 characters of links.
- **Fix, each step measured before the next:** (1) file-level lookup — rows whose linked entries mention the edited file: 53% → 62% of files. (2) Entries name files by bare filename as often as by path; matching the bare name when it is unique among tracked files: → 71%, at a median of one entry per file. (3) Links cut to 8 per section, the entries naming this file first: largest injection 13,259 → 2,683 characters, average 1,789 → 929. (4) A row delivered once in a session is not delivered again through another file. Same replayed session after the change: 11 injections, 18 distinct gotchas, about 1,900 tokens. Cost: median 24 → 28 ms per edit.
- **Also added, because the above could not have been found without them:** the hooks now log every decision (`scripts/gwork-stats.mjs` reads it) · state is dropped when the context is cleared or compacted · shell writes of forbidden content are denied · `pre-commit` runs check F on the index · a session-start note after 3 commits with no entry · `scripts/gwork-log.mjs` computes the mechanical half of a close-out · `scripts/gwork-install.mjs` replaces 22 manual steps.
- **Harness:** `node e2e/tools/unit.mjs` 90/90. **Not measured:** whether delivered gotchas change what an agent does — that needs the LLM e2e scenarios, and the new log from real sessions. The shell-write check is pattern matching on a command line; it can be evaded and is documented as best effort.

## L-008 — an installed repo held two fixes the kit never received, and its INDEX was almost entirely unreachable

- **Date:** 2026-11-11 · **Repo:** an installed repo in sustained daily use
- **Symptom:** nothing failed. The installed `pre-push`, `commit-msg` and `tasklog-check.mjs` differed from the kit; and the gotcha hook could match only a handful of the module names in INDEX.
- **Root cause:** (1) two field fixes were made in the installed copies only — hooks resolving `node` when git runs them with a narrow `PATH`, and check F passing its pattern as an argv item — against the Self-repair rule that a fix lands at the source. Nothing detects an installed copy drifting ahead of the kit. (2) INDEX rows were filed under topic names while the hook derives the name from the file path via `gwork.json → modules`; the two vocabularies never met, and no check compares them. (3) Where a name did match, the hook read the first row only, so every further row of the same name was hidden.
- **Fix:** both field fixes are now in the kit · the gotcha hooks (Claude and Hermes) merge every row filed under the module, capped at 12 gotchas per injection · `tasklog-check` prints a non-blocking note naming how many INDEX module names no tracked file can produce · `commit-msg` has unit cases that run a real `git commit` · a CI workflow asserts hook mode and line endings on three operating systems · `scripts/gwork-drift.mjs` reports each installed copy as same, behind, or edited in place, so a fix living only in a copy is seen before an update overwrites it · the checker also notes modules holding 2+ gotchas with no BC.
- **Harness:** `node e2e/tools/unit.mjs` 56/56, now with a blocking case for every check A–H. **Not fixed, by design:** the vocabulary mismatch itself — whether rows should be renamed, rules widened, or matching changed is an owner decision. The CI workflow has not run on a real runner.

## L-007 — the gotcha hook auto-approved every edit, and two profile injections were never delivered

- **Date:** 2026-11-11 · **Repo:** gwork itself (hook contract checked against the Claude Code docs)
- **Symptom:** none visible — that is the problem. `tasklog-gotcha.mjs` answered `permissionDecision: "allow"` on every edit it did not deny; `model-profile.mjs` emitted `additionalContext` at the top level for `SessionStart` and `SubagentStart`.
- **Root cause:** both shapes were assumed, not read from the hooks reference. `"allow"` is documented as skipping the user's permission prompt, not as a neutral pass. Top-level `additionalContext` is documented as ignored without an error — so the subagent profile never arrived, and a `SessionStart` that resolved the model recorded "injected" and silenced every later event for that model.
- **Fix:** the gotcha hook prints nothing when it has nothing to say and returns `additionalContext` with no `permissionDecision` otherwise · every model-profile event nests `additionalContext` in `hookSpecificOutput` · `PostModelSwitch` (2.1.251+) is handled from `to_model`, the documented channel that L-005's transcript reading was a workaround for · display-name switch records (``Set model to `Sonnet 5.5` and saved as…``) resolve · events fired inside a subagent no longer receive the main-model profile.
- **Harness:** `node e2e/tools/unit.mjs` 34/34 · `node e2e/tools/unit-model-profile.mjs` green twice. **Not covered:** none of this has been confirmed in a live session — the unit cases prove the output shape, not that the harness honours it. Per L-005, that needs a real transcript (`claude --debug`, look for `Hook JSON output had unrecognized keys`).

## L-006 — on Linux/macOS every git gate is off: the hooks ship without the executable bit

- **Date:** 2026-11-11 · **Repo:** gwork itself (first clone on Linux)
- **Symptom:** `node e2e/tools/unit.mjs` → `FAIL sentinel-prepush-blocks`; a real `git push` printed only `hint: The 'githooks/pre-push' hook was ignored because it's not set as executable` and went through. commit-msg was skipped the same way — no tsc, no tasklog-check, no sentinel at push time.
- **Root cause:** `githooks/*` were committed as mode `100644` (authored on Windows, where the bit does not exist and git runs hooks regardless). Install copied them as-is, and no step set or checked the bit.
- **Fix:** mode `100755` in the index for both hooks · install step 2 (SKILL.md, README) now runs `chmod +x githooks/*` and checks `git ls-files -s githooks` · unit case `githooks-executable`.
- **Harness:** `node e2e/tools/unit.mjs` 32/32 (was 17/18 on Linux). Same pass added: pre-push blocks a pushed commit that is neither HEAD nor already on a remote, tasklog-check calls git with argv instead of a shell string, check G attributes the owner trailer per commit instead of to the last commit on the file, both gotcha hooks resolve the repo from the edited file before cwd, sentinel treats a deleted snapshot as tamper, check C counts text behind an escaped `\|`, migrate refuses to overwrite an existing INDEX, model-profile falls back from a minor revision to its family profile (current ids such as `claude-fable-5-2` matched no file, so nothing was ever injected).

## L-005 — a `/model` switch is not in the transcript when UserPromptSubmit fires

- **Date:** 2026-07-27 · **Repo:** gwork itself (model-profile hook, first live use)
- **Symptom:** switching model mid-session left the **previous** model's profile live in context for a full turn. Opus 5 ran a turn under Fable 5's "delegate freely, use verifier subagents" — the exact conflict the profiles exist to prevent.
- **Root cause:** the design assumed the `<local-command-stdout>Set model to X</local-command-stdout>` record is written before the next `UserPromptSubmit` hook runs. It is not. Measured against a live session: the record *is* in the transcript above the prompt afterwards, but at hook time the newest record was still the previous turn's assistant message carrying the **old** model — so the hook saw no change and stayed silent. Unit tests all passed because they synthesised transcripts that already contained the switch; the assumption itself was never tested.
- **Fix:** layered — the `/model <id>` prompt text is read directly at `UserPromptSubmit` (the only signal that exists at the moment of the switch), `PreToolUse` catches it at the first tool call (by then the transcript has it), and a switch now states that the previous profile no longer applies, since it is still sitting in the context window. Live use then showed the residual gap: a `/model` typed as a **local command** never passes through `UserPromptSubmit` as prompt text at all, so a **text-only turn** (no tool calls) would still run under the stale profile — closed by adding `Stop`, which injects at the end of that turn so the next one starts correct.
- **Harness:** `node e2e/tools/unit-model-profile.mjs` 28 cases, green twice in a row. **Lesson for the kit:** when a hook depends on *when* the harness writes something, test against a real transcript — a synthetic fixture encodes the assumption instead of checking it.

## L-004 — a hook unit suite goes green once, then red on every rerun

- **Date:** 2026-07-27 · **Repo:** gwork itself (model-profile hook)
- **Symptom:** `node e2e/tools/unit-model-profile.mjs` passed 17/17, then failed 8/17 on the very next run with no code change in between. Re-running again stayed red.
- **Root cause:** the hooks keep per-session state in a **shared tmp dir** (`tmpdir()/<hook>/<session_id>.json`) so a rule is injected once per session, not once per prompt. The suite used fixed session ids (`s1`, `s2`…), so the second run looked like the same session continuing — the hook correctly stayed silent and the assertions expecting an injection failed. The hook was right; the test was not rerun-safe.
- **Fix:** session ids in the suite are now unique per run (`test-<pid>-<base36 time>-<n>`), with a comment saying why. Any future test of a state-keeping hook must do the same, or clear the state dir first.
- **Harness:** `node e2e/tools/unit-model-profile.mjs` green twice in a row · `node e2e/tools/unit.mjs` 15/15 unaffected.

## L-003 — tasklog-check spams `fatal: path ... does not exist` on every run against a young baseline

- **Date:** 2026-07-23 · **Repo:** sale-visit-system (first install)
- **Symptom:** every checker run printed 4-7 `fatal:` lines to stderr even when green — files new since the upstream baseline (gwork.json, task-log/*) make `showAt(ref, path)` probe refs that don't have them. Harmless but it reads like a failure and buries real errors.
- **Root cause:** `git()` helper used `execSync` default stdio → child stderr inherited. The `catch { return null }` already treats a miss as expected, but the noise still leaked.
- **Fix:** `stdio: ['pipe', 'pipe', 'ignore']` in the `git()` helper (`scripts/tasklog-check.mjs`) — expected-miss lookups are silent; real failures still surface as check errors.
- **Harness:** e2e unit 15/15 pass after change · green run verified in the repo (0 fatal lines).

## L-002 — install silently loses the checker when the target repo gitignores `/scripts/`

- **Date:** 2026-07-23 · **Repo:** sale-visit-system (first install)
- **Symptom:** `git add scripts/tasklog-check.mjs` → "paths are ignored by one of your .gitignore files". Repo had `/scripts/` ignored (its own temp-script convention). Without noticing, the kit would run locally but break for every clone/CI.
- **Root cause:** install steps assumed `scripts/` is trackable. Extra trap: adding `!/scripts/tasklog-check.mjs` under `/scripts/` does nothing — git never descends into a fully-excluded directory, so negations inside are dead.
- **Fix:** install step 2 now requires `git check-ignore` on the copied paths; the documented remedy is `/scripts/*` (ignore contents, not the dir) + `!` negations for the kit files.
- **Harness:** not code — instruction fix in SKILL.md step 2.

## L-001 — migrate.mjs parses 0 entries from a CRLF legacy log

- **Date:** 2026-07-23 · **Repo:** sale-visit-system (first install)
- **Symptom:** `node scripts/migrate.mjs "update task.md"` → `parsed 0 entries`, empty INDEX, no error. The 4,400-line log clearly had 196 `## YYYY-MM-DD` headers.
- **Root cause:** file was CRLF; `raw.split('\n')` leaves `\r` on every line, and in JS regex `.` does not match `\r` (it's a LineTerminator) — so the header regex's `(.*)$` failed on every single header. Silent because 0 matches is a legal outcome.
- **Fix:** `split(/\r?\n/)` in `scripts/migrate.mjs` (with a why-comment). Any future kit script that splits file lines must use `/\r?\n/`.
- **Harness:** migrate.mjs is not covered by e2e (stated per protocol step 4) — verified by re-running the real migration: 196 entries, 3 shards, INDEX 144 modules.
