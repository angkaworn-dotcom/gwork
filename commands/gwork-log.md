---
description: Close out a task — write the task-log entry + update INDEX in one commit
---

Close out the work just completed into the task-log per gwork rules. Communicate with the user in their language; the entry itself may be written in any language.

1. `node ~/.claude/skills/gwork/scripts/gwork-log.mjs --title "<short title>"` → read the plan it prints: the next anchor id, the files and commits since the last entry, the modules they map to, and the INDEX rows it will touch. Wrong scope (it reaches back to the last commit that touched `task-log/`)? Pass `--since <ref>`.
2. Same command with `--write` → it appends the entry skeleton to `task-log/<YYYY-MM>.md` and links it from every touched module's row (new module = new row). Never hand-write the anchor or the links.
3. Replace every `TODO` in the entry: context/problem · Decision · Gotcha · Validation actually run · **impact on prior work** (none = say "none"). Trim the file list if it is noise.
4. A real lesson → put it in the Gotcha column of the row it belongs to, ≤1 line. Nothing learned → leave `—`.
5. If this gotcha has now occurred ≥2 times, or was destructive once → propose promoting it to a BC-xxx in CLAUDE.md and reduce the gotcha column to the BC number (the checker's `note:` line lists modules already past that point).
6. Run `node scripts/tasklog-check.mjs` — must be green. Then commit the shard + INDEX together in one commit (`docs: ...`).

Never batch multiple tasks into one entry — one task, one entry.

$ARGUMENTS
