---
name: gwork-check
description: Health-check the task-log (INDEX/links/gotchas) and fix whatever is red
version: 1.0.0
---

Check task-log consistency in the current repo. Communicate with the user in their language. Apply any extra instruction the user passed with this skill invocation.

1. Run `node scripts/tasklog-check.mjs` (if the repo has no copy, run it from your gwork clone with `--dir task-log`).
2. Green → report briefly: how many entries, done.
3. Red → explain each error in plain words, then fix it:
   - **A** entry not referenced from INDEX → add the link to the relevant module rows (read the entry to see which files it touched)
   - **B** rotten link / wrong shard → fix the path or anchor to the real location
   - **C** gotcha too long → distill to one line (keep the essence: what to watch out for + how to prevent it)
   - **D** BC exists but row still carries text → move details into the BC in CLAUDE.md, leave only the BC number in INDEX
4. Re-run until green, then summarize what was fixed — do NOT commit; let the user review first.
