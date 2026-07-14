---
description: Report gwork status in the current repo — install completeness, active config, log health
---

Report the current repo's gwork status concisely. Communicate with the user in their language.

1. **Install completeness:**
   - does `git config core.hooksPath` point to `githooks` · do `githooks/pre-push` + `commit-msg` exist
   - does `scripts/tasklog-check.mjs` exist · does `task-log/INDEX.md` exist
   - does `~/.claude/hooks/tasklog-gotcha.mjs` exist + is PreToolUse registered in `~/.claude/settings.json`
2. **Config:** is there a `gwork.json` → does it parse → show which keys override defaults (no file = say all defaults are active)
3. **Task-log health:** run `node scripts/tasklog-check.mjs` → green/red, entry count · when was the latest entry vs the repo's latest commit (code much newer than the log = unclosed work)
4. **BCs:** count BCs in CLAUDE.md + INDEX rows whose gotcha repeats ≥2 times but was never promoted

Summarize as a short ✅/❌ table + targeted suggestions for what's missing. This command only reports — change nothing.

$ARGUMENTS
