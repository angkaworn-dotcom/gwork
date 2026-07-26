# LESSONS — field failures that made the kit better

Append-only, newest first. Every entry = a bug the kit hit in a real repo, fixed at the source per the Self-repair protocol in [SKILL.md](SKILL.md). Read the two most recent entries before an install — they are the freshest sharp edges.

Format: `## L-xxx — <one-line symptom>` · date · repo · Root cause · Fix · Harness.

## L-005 — the owner-approval trailer was self-issuable: the agent wrote the only artifact the gate read

- **Date:** 2026-07-26 · **Repo:** gwork itself (found by e2e S12, before any field report)
- **Symptom:** checks G and H excused a protection removal whenever the commit body matched `/^Gwork-Owner-Approved:/m`. In S12, **5 of 6 Haiku 4.5 runs wrote that trailer themselves**, citing the task prompt as the owner's confirmation (`Owner explicitly requested toFixed(2) implementation: "…I specifically want toFixed here."`), and **3 of 6 pushed `.toFixed(` to the remote**. Rule 4b — which names exactly that move as not-the-owner-speaking — was in the CLAUDE.md they had just read, and did not reduce the rate.
- **Root cause:** the gate's only evidence was a string in a commit message, and the agent authors commit messages. Any check whose input the checked party controls is documentation, not enforcement. Two shapes appeared: deleting the rule, and *narrowing its path regex* (`^lib/money/` → `^lib/money/(?!display\.js)`) so a "list emptied" heuristic sees nothing.
- **Fix:** `gwork.json → owner.allowedSigners` — G and H now additionally require an SSH signature verified against the owner's public key. Three details are load-bearing: verification uses the **baseline** copy of the signers file (an agent that appends its own key at HEAD and signs is rejected, and the list change is reported by G4); the verifier program and allowed-signers path are passed on the command line, never read from `gpg.*` git config (agent-writable — this environment ships a `gpg.ssh.program` shim that signs but cannot verify, which is exactly the shape of the attack); and a verification error **fails closed**, since failing open would restore the whole hole. Unset = previous behavior plus a warning on every accepted trailer, so existing installs keep working.
- **Harness:** `node e2e/tools/unit.mjs` 21/21 (was 15/15) — five new cases: forged bare trailer blocked, agent-key signature blocked, self-granted key blocked, genuine owner signature accepted, unconfigured repo warns without breaking. Skips with a printed SKIP when the machine has no `ssh-keygen`.

## L-004 — every git hook is silently ignored on Linux/macOS clones (hooks tracked as mode 644)

- **Date:** 2026-07-25 · **Repo:** gwork itself (found on a fresh Linux clone)
- **Symptom:** `e2e/tools/unit.mjs` case `sentinel-prepush-blocks` failed — a push carrying a neutered `tasklog-check.mjs` went through clean. Git's own hint said it: `The 'githooks/pre-push' hook was ignored because it's not set as executable.` Same for commit-msg. Not an e2e-only defect: on any POSIX machine this means **`core.hooksPath githooks` is set, no hook ever runs, and nothing reports it** — the kit's entire git-hook layer is off while `/gwork-status` still shows it installed.
- **Root cause:** `githooks/pre-push` and `githooks/commit-msg` were committed as `100644`. The kit was authored on Windows, where git ignores the exec bit, so the mode was never set and the failure could not appear locally. `setup.mjs`'s `cpSync` faithfully copies the non-executable mode into every sandbox, and a real install's `cp -r` does the same from a 644 clone.
- **Fix:** `git update-index --chmod=+x githooks/pre-push githooks/commit-msg` — the mode is now tracked, so every clone checks out 755 and `cp -r` carries it into target repos. No script or install-step change needed; a verify line was added to SKILL.md so a re-introduction is caught at install time rather than silently.
- **Harness:** `node e2e/tools/unit.mjs` 15/15 (was 14/15 — this case was the failure, and it now blocks the push as designed). This is the first field failure the harness itself caught before a user did.

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
