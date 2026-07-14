---
description: Close out a task — write the task-log entry + update INDEX in one commit
---

Close out the work just completed into the task-log per gwork rules. Communicate with the user in their language; the entry itself may be written in any language.

1. From git diff/log, determine what this task touched, what problem it solved, and which commits.
2. Append an entry to `task-log/<YYYY-MM>.md` (current month; create the file if missing):
   - anchor `<a id="YYYY-MM-DD-n"></a>` — n is the seq when the day has multiple entries (check existing ids, never duplicate)
   - header `## YYYY-MM-DD — <short title>`
   - body: context/problem · files changed · commit hash · Decision (if any) · Gotcha (if any) · Validation actually run · **impact on prior work** (none = say "none")
3. Update the INDEX row (`task-log/INDEX.md`) of **every touched module** — prepend the new entry link to the Entries column · new module = new row · real lesson learned = fill the Gotcha column, ≤1 line.
4. If this gotcha has now occurred ≥2 times, or was destructive once → propose promoting it to a BC-xxx in CLAUDE.md and reduce the gotcha column to the BC number.
5. Run `node scripts/tasklog-check.mjs` — must be green. Then commit the shard + INDEX together in one commit (`docs: ...`).

Never batch multiple tasks into one entry — one task, one entry.

$ARGUMENTS
