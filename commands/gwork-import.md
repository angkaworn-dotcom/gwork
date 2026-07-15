---
description: Import rules in bulk from a file (old CLAUDE.md, team conventions, any rules doc) — classifies each rule and routes it like /gwork-rule, as one reviewed batch
---

Import every rule found in the given file into this repo's gwork setup. Communicate with the user in their language.

**1. EXTRACT — read the whole file in chunks, collecting rules verbatim** (`$ARGUMENTS` — a path to an old CLAUDE.md, a conventions doc, or any rules file). If no path was given, ask for one. Long files get silently truncated by read tools, and a rule you never saw is a rule you silently drop — so extraction is its own pass, mechanical and complete, BEFORE any classification:
- check the file's total line count first;
- read in chunks of ≤300 lines (read-tool offset/limit or shell line ranges) until the last chunk visibly contains the final line;
- from each chunk, copy out candidate rules verbatim with their line numbers — obligations/prohibitions only, no routing decisions yet;
- finish with a cross-check: search the whole file for imperative keywords (`must|never|always|forbidden|do not|ask.*before`) and reconcile every hit against the candidate list.

Ignore prose that isn't a rule (project descriptions, meeting notes, architecture background) but mention what you skipped. Generic truisms with no project-specific decision content ("prefer clarity", "use good names") are noise, not rules — drop them; CLAUDE.md frugality outranks completeness of platitudes.

**2. CLASSIFY — take the collected candidate list (now small) and route each rule with the /gwork-rule decision tree** — can a machine check it with no judgment?

Deterministic → route by channel:
- commit-message rules → `gwork.json` → `commit.types`
- a command that can run before push (fails = push blocked) → `gwork.json` → `prepush`
- task-log hygiene thresholds → `gwork.json` → `tasklog.maxGotcha` / `bcGotchaMax`
- file-to-module mapping → `gwork.json` → `modules` (JSON regexes need `\\w`)
- beyond config scope → `scripts/tasklog-check.mjs` / `migrate.mjs` following existing patterns

Not deterministic — check in THIS order:
- Does the rule name a specific file, directory, or module? Then it is a module lesson → that module's Gotcha column in `task-log/INDEX.md` (the hook injects it when the module is touched), NOT CLAUDE.md — even if it reads like a judgment call.
- Only rules about how to work in general (no specific file/module named) → CLAUDE.md, ≤2 lines each — but first ask whether a deterministic version hides inside it; if so, propose that route instead

**3. Dedupe before proposing:** drop rules the hooks already enforce (commit format, INDEX link health, tsc-on-push, ...) and rules already present in `gwork.json` / INDEX / CLAUDE.md. List them as "already covered".

**4. Present the routing table and STOP for approval** — a batch import touches many places at once, so show one table (rule → destination → exact change) plus the skipped/already-covered lists, and wait for the user's go before writing anything. Apply user corrections to the table, not ad-hoc.

**5. After approval, apply the batch**, then test at least one imported rule per destination for real (a commit/push/file-edit that should be caught, and one that shouldn't) and report results — do NOT commit; leave the diff for the owner to review.

Source file: $ARGUMENTS
