---
description: Report gwork status in the current repo — install completeness, active config, log health
---

Report the current repo's gwork status concisely. Communicate with the user in their language.

1. **Install completeness:**
   - does `git config core.hooksPath` point to `githooks` · do `githooks/pre-push` + `commit-msg` exist
   - does `scripts/tasklog-check.mjs` exist · does `task-log/INDEX.md` exist
   - does `~/.claude/hooks/tasklog-gotcha.mjs` exist + is PreToolUse registered in `~/.claude/settings.json`
   - does `~/.claude/hooks/model-profile.mjs` exist + are all six events registered (SessionStart ·
     UserPromptSubmit · SubagentStart · PreToolUse · Stop · PostModelSwitch) · does a profile exist for the model you are running as
     (`~/.claude/gwork-profiles/<model>.md`, or the repo's `profilesDir`) — no file = nothing is injected,
     which is a gap to report, not a failure
   - `node ~/.claude/skills/gwork/scripts/gwork-drift.mjs` → quote its lines verbatim. `behind` = an update
     fixes it · `local edit` = a fix made in place that the kit never received: say so plainly, it is lost
     on the next update unless it is moved into the kit first
2. **Config:** is there a `gwork.json` → does it parse → show which keys override defaults (no file = say all defaults are active)
3. **Task-log health:** run `node scripts/tasklog-check.mjs` → green/red, entry count · when was the latest entry vs the repo's latest commit (code much newer than the log = unclosed work)
4. **What the hooks did:** `node ~/.claude/skills/gwork/scripts/gwork-stats.mjs` → quote it. A low hit rate with a full INDEX means the rows are filed under names the edits never reach
5. **BCs:** count BCs in CLAUDE.md · quote the checker's `note:` lines (modules holding 2+ gotchas with no BC,
   INDEX module names the hook can never reach)

Summarize as a short ✅/❌ table + targeted suggestions for what's missing. This command only reports — change nothing.

$ARGUMENTS
