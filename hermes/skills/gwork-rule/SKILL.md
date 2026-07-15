---
name: gwork-rule
description: Add/change a gwork rule — routes it to the right place (gwork.json / code / CLAUDE.md)
version: 1.0.0
---

Add or change the rule the user describes (the instruction passed with this skill invocation), following the gwork decision tree. Communicate with the user in their language.

**First, classify:** can this rule be checked deterministically (a machine decides, no judgment needed)?

**If yes — enforce it in the system, by channel:**
1. About commit messages → edit `gwork.json` → `commit.types`
2. A check runnable before push (command that fails = push blocked) → add to `gwork.json` → `prepush`
2b. An absolute prohibition tied to files ("NEVER X in Y") expressible as path+pattern regexes → `gwork.json` → `forbidden: [{path, pattern, reason}]` (tasklog-check F blocks the push; only the owner can override, by editing the list) — prefer this over an INDEX gotcha whenever the pattern is greppable
3. Task-log hygiene thresholds → `gwork.json` → `tasklog.maxGotcha` / `bcGotchaMax`
4. File-to-module mapping → `gwork.json` → `modules` (JSON regexes need `\\w`)
5. Beyond config scope (new INDEX check rules, log formats) → edit `scripts/tasklog-check.mjs` / `migrate.mjs` following existing patterns
- No `gwork.json` in the repo yet → copy `gwork.example.json` from your gwork clone first, then edit (delete keys you didn't change — keep only overrides).

**If no — add to CLAUDE.md as frugally as possible:**
- Before adding, ask again whether it can be squeezed into a check after all (many judgment-looking rules hide a deterministic version) — if so, propose that route first.
- If it's a lesson tied to one specific module → put it in the INDEX Gotcha column instead (the hook will inject it), not CLAUDE.md.
- CLAUDE.md gets pure-judgment rules only, ≤2 lines each.

**Always finish by:** testing the new rule for real (try a commit/push/file-edit that should be caught, and one that shouldn't), then report the results — do NOT commit.
