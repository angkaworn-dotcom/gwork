# LESSONS — field failures that made the kit better

Append-only, newest first. Every entry = a bug the kit hit in a real repo, fixed at the source per the Self-repair protocol in [SKILL.md](SKILL.md). Read the two most recent entries before an install — they are the freshest sharp edges.

Format: `## L-xxx — <one-line symptom>` · date · repo · Root cause · Fix · Harness.

## L-018 — a task router by difficulty: what the data let it claim, and what it did not

- **Date:** 2026-11-11 · **Repo:** real subagent briefs from past work, read for their shape only
- **Asked for:** something that splits work by difficulty and says which model should take it.
- **First version, and why it was wrong:** score a brief from its files, the repo's history and three word lists. Run on real briefs it put almost all of them in the top tier. Three signals fired on nearly every brief and so said nothing: brief length, "a forbidden rule guards this path" (a rule that covers most of an app — and a path behind a hard gate needs a strong model *less*, not more), and risk words anywhere in the text (a long brief says "production" somewhere whatever it is about).
- **What the effort data showed:** where a brief's result recorded what the subagent spent, no word list separated cheap work from expensive work. The only signal that tracked effort was breadth: briefs naming ten or more files took about twice the tool calls, with a weak positive rank correlation between files named and tool calls.
- **What was built:** `hooks/model-route.mjs`. Breadth and recorded history (bug class, gotcha) carry the score; the word lists stay as tunable priors and are read from the task statement only. It advises when the model chosen for a subagent sits below its tier or two steps above it (`block-once` denies the call once instead), and the same judgment is a command for a person choosing a session's model. Because the thresholds are not proven, the hook also records what every subagent really cost, and `gwork-stats.mjs` prints tokens and tool calls per tier — the test of whether the tiers mean anything.
- **Also seen:** the large majority of subagent calls set no model at all, so they ran on the session's own. The cheap win is not finer tiers; it is naming a model for the light work.
- **Harness:** `node e2e/tools/unit-edge.mjs` 391/391, 45 routing cases. **Not shown:** that following the advice saves anything or costs quality. That needs the per-tier numbers from real use, and the default thresholds will sit differently in a repo whose briefs routinely name many files.

## L-017 — one model switch, three profile blocks, the first one naming the wrong model

- **Date:** 2026-11-11 · **Repo:** a live Claude Code session (2.1.318, desktop) whose model was switched from another session
- **Symptom:** after a switch from Fable to Sonnet the session received three `[gwork] Running on …` blocks: from `UserPromptSubmit`, naming **Fable** and saying the Sonnet profile no longer applied; from `PostModelSwitch`, naming Sonnet (correct); from the first `PreToolUse`, naming Sonnet again.
- **Root cause:** `PostModelSwitch` recorded the new model, then `UserPromptSubmit` read the transcript tail — documented as lagging, and still holding the old model — took the disagreement for a switch back, and announced the old model. Once the transcript caught up, the next event "switched" forward again. L-005 had met the same lag from the other side and layered three events on it; the events then fought each other.
- **Fix:** the state records where the model came from. Once `PostModelSwitch` has named it, a transcript that disagrees is ignored as stale; a harness that sends that event sends it for every change, so nothing is lost. Older builds, which never send it, keep believing the transcript. `/clear` and compaction forget the authority with the rest of the state.
- **Harness:** `node e2e/tools/unit-model-profile.mjs` green twice, with both event orders and a switch back; three of those cases fail on the old hook, reproducing the three blocks. Confirmed live: after the fix, switching back produced exactly one block, from `PostModelSwitch`, and the state read `{"model":"fable-5-2","injected":true,"source":"switch"}`.
- **How it was found:** the owner did not have to type `/model` — a second session was started to test, and its model was switched from the first.

## L-016 — first session started with every hook in place: a shell write from outside the repo was never looked at

- **Date:** 2026-11-11 · **Repo:** an e2e sandbox, driven from a real Claude Code session (2.1.318, desktop) whose working directory was the kit, not the sandbox
- **Confirmed live:** the `Bash` matcher fires — with the working directory inside the repo, `echo "n.toFixed(2)" > lib/money/x2.js` was denied with `[gwork forbidden] this command writes …` and no file appeared; a clean heredoc into the same module ran and carried the module gotcha as hook context · the model profile arrives on the first tool call of a fresh session (`PreToolUse`), not at `SessionStart`: nothing has named the model yet when the session opens.
- **Symptom found:** from a working directory outside the repo, `cd <repo> && echo "n.toFixed(2)" > lib/money/x.js` was not denied. The file was written, and the hook log held no line.
- **Root cause:** the `Bash` branch looked the repo up from the session's working directory only. Edits take the repo from the file being edited; shell writes did not, so the leading `cd` moved the target but not the rules. An absolute target had the same hole.
- **Fix:** each shell-write target is resolved to a path and decides its own repo, with the working directory as the fallback — the rule edits already followed. A command writing into two repos is checked against both forbidden lists; lessons come from the first.
- **Harness:** `node e2e/tools/unit-edge.mjs` 346/346, five new `bash-root` cases, three of which fail on the old hook. **Still not checked live:** context returned at `SessionStart` (this session opened where there was nothing to say, and a silent hook leaves no trace of having run), and that an edit still prompts for permission (the session ran in a mode that never prompts).

## L-015 — an agent that never uses the edit tools never gets a gotcha

- **Date:** 2026-11-11 · **Repo:** e2e sandboxes, seven scenarios run by real agents (results in `e2e/scenarios.md`)
- **Symptom:** in S3 the agent followed the money gotcha and passed — but the hook log held no line for that run. Asked how it wrote its files, it answered: every one through the shell (`cat > f <<EOF`, a python one-liner), none through Edit or Write.
- **Root cause:** lessons were attached to `Edit|Write|MultiEdit` only. A model that prefers the shell bypasses the whole injection path without trying to; it complied only because CLAUDE.md told it to read INDEX itself.
- **Fix:** the lookup is now one function used by both branches. A shell write whose target is inside the repo (redirect, heredoc, `tee`, `sed -i`, after a leading `cd`) gets the same module and file lessons an edit would, once per session, at most four targets per command. A file written by a script (`python -c`) still gets nothing — the command line does not name it reliably.
- **Also found:** the e2e verifier failed S3 for a comment that named `.toFixed()` above correct code; it now strips comments first. And the edge suite asked `setup.mjs` for sandbox "30", which is a count — it had been building thirty repos per run.
- **Harness:** `node e2e/tools/unit-edge.mjs` 341/341 with six cases for lessons on shell writes. Panel: 5 of 7 pass; the two that fail stopped and asked instead of proceeding, with nothing forbidden written.

## L-014 — 65 of 336 odd cases failed: the kit had only ever been tested with input it expected

- **Date:** 2026-11-11 · **Repo:** gwork itself (edge-case pass, `e2e/tools/unit-edge.mjs`)
- **Symptom:** none in the field. A suite of inputs nobody writes on purpose — wrong types, hostile ids, exotic configs and repos, ten ways of writing a file from a shell — was run against `main`: 65 cases failed.
- **What they were, by weight:**
  - **A gate switched off quietly.** `gwork.json` holding `null` or an array crashed the checker with a stack trace instead of "cannot parse". A non-numeric `maxGotcha` compared as "never too long". A commit subject of `-n feat: x` was accepted, because `echo` ate the `-n`. A configured commit type was used as a regular expression (`feat+` accepted `featt`). The same anchor id defined in two shards went unreported.
  - **A write outside its box.** The session id is used as a file name for hook state; `../x` wrote outside the state directory. A model id was used as a profile file name the same way.
  - **Wrong verdicts on shell writes.** `2> lib/money/err.log` was denied although only stderr goes there (a false block). `tee a b`, `sed --in-place`, `>|`, and `cd lib/money && echo … > a.js` were not seen (false passes).
  - **Installer.** `"hooks": []` in settings.json made the registration vanish without a word. Pointing `--repo` at a subdirectory installed hooks git would never run. A read-only directory ended in a stack trace.
  - **Things that looked like data and were not.** A markdown alignment row (`|:---|`) was counted as a module. A kit copied into another repository answered drift questions with that repository's history. A `forbidden` pattern with nested repetition could hang every edit; it is now refused by the checker and skipped, out loud, by the hook.
- **Fix:** each of the above, plus a BOM in `gwork.json`, an 8-second stall at session start when the drift tool hangs (now 2.5 s), a reminder threshold of `-1` meaning "always", and a damaged log line crashing `gwork-stats`.
- **The other half of the suite — simulation.** `SessionStart`, a `Bash` call and `PostModelSwitch` could not be driven from the live session, so every hook reply in the suite is held to the harness's documented contract instead: exit 0, no stderr, stdout empty or one JSON object, context only inside `hookSpecificOutput` under the right event name, never `allow`, never over 10,000 characters, inside a time limit.
- **Harness:** `node e2e/tools/unit-edge.mjs` 336/336, twice in a row; `unit.mjs` 114/114. **Still a simulation:** the contract is what the documentation says the harness accepts, not an observation of the harness accepting it.

## L-013 — first live check: the hooks work in a real session, and a profile was never delivered because the state said it had been

- **Date:** 2026-11-11 · **Repo:** an e2e sandbox, driven from a real Claude Code session (2.1.309, desktop)
- **Confirmed live:** `additionalContext` with no `permissionDecision` reaches the model on `PreToolUse` (module gotcha, file-level gotcha, model profile) · the `deny` shape blocks a `Write` that carries a forbidden pattern, and the file is not created · both decisions land in `~/.gwork/log` and `gwork-stats.mjs` reads them back · a minor model revision (`fable-5-2`) receives its family profile.
- **Symptom found:** the session had run for hours with no model profile, although a matching profile existed.
- **Root cause:** `model-profile.mjs` recorded the model in its state file even when no profile file matched, then skipped every later event for that model. The profile became available later (the family fallback was added and synced mid-session) and was never injected.
- **Fix:** the state records whether a profile was delivered; only a delivered profile suppresses the next look, and only a delivered profile is ever announced as superseded. Confirmed live: the next tool call after syncing the fix carried the profile.
- **Harness:** `node e2e/tools/unit-model-profile.mjs` green twice, with a case for a profile that appears after a silent first look. **Still not checked live:** `SessionStart` output, the `Bash` matcher and `PostModelSwitch` (registered after this session began), and that an edit prompts for permission again.

## L-012 — a note I added was a false signal; two tools were not built because the data said no

- **Date:** 2026-11-11 · **Repo:** a real INDEX of 500+ rows, measured read-only
- **Symptom:** the checker printed "31 modules hold 2+ gotchas and no BC — a lesson that repeats belongs in CLAUDE.md". It read as 31 unpromoted repeats.
- **Root cause:** the note counted lessons per module and called that repetition. Measured: the rows were distinct lessons. Character-trigram overlap of half or more between two gotchas occurred **zero** times in the whole INDEX, within a module or across it.
- **Fix:** the note now fires only when two rows of one module carry nearly the same text and neither has a BC. On the same INDEX it is silent, which is the correct answer.
- **Not built, on the same measurement:** a BC-promotion tool (nothing was repeating, so there was nothing to promote) and an INDEX tidy tool (no duplicate rows, no duplicate links, a median of one link per row; capping links would save 10%). Both were on the list of ideas; neither had evidence.
- **Built instead:** a session-start notice, once a day, when an installed copy is behind or edited in place or the kit holds uncommitted files — stale copies and unpushed fixes were found five times in one day and nobody had been told · `templates/gwork-check.yml` with `gwork-install.mjs --ci`, the server-side check that `git push --no-verify` cannot skip.
- **Harness:** `node e2e/tools/unit.mjs` 114/114. The workflow template parses as YAML and its steps were exercised locally (detached HEAD with `GWORK_BASE`); it has not run on a GitHub runner in an installed repo.

## L-011 — check F and the edit hook read the same rule with two different regex engines

- **Date:** 2026-11-11 · **Repo:** gwork itself (gate-precision pass)
- **Symptom:** none yet in the field — found by reading. A `forbidden` pattern was validated and enforced at edit time by JavaScript's engine, then enforced at push by `git grep -P` (PCRE). A pattern valid in one and not the other (a variable-length lookbehind, a `\u` escape) either meant something different at push or made the whole checker exit with "git grep failed"; a git built without PCRE failed every push.
- **Fix:** check F matches in JavaScript, line by line, over contents read with one `git cat-file --batch` for the files a rule's path can touch — from HEAD, or from the index with `--staged`. One engine, no PCRE dependency. Related: a `gwork.json` that exists but cannot be parsed used to switch the edit-time forbidden check off silently (the push still failed loud); both hooks now say so once per session.
- **Harness:** `node e2e/tools/unit.mjs` 113/113, including a rule only JavaScript can parse, a binary file, CRLF lines and a staged deletion. **Cost, measured** on a repo whose one rule spans about 800 files: the checker went from 77 to 173 ms at push and from 59 to 87 ms at commit. Reading the files is the cost (about 100 ms); a whole-file prefilter before the per-line pass saved under 10 ms.

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
