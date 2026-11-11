# LESSONS — field failures that made the kit better

Append-only, newest first. Every entry = a bug the kit hit in a real repo, fixed at the source per the Self-repair protocol in [SKILL.md](SKILL.md). Read the two most recent entries before an install — they are the freshest sharp edges.

Format: `## L-xxx — <one-line symptom>` · date · repo · Root cause · Fix · Harness.

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
