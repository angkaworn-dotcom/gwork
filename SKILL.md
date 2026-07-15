---
name: gwork
description: Install the gwork discipline kit (git pre-push/commit-msg hooks, task-log INDEX checker, PreToolUse gotcha-injection hook, short CLAUDE.md template) into any git repository. Use when user says "install gwork", "setup discipline kit", "ติดตั้ง gwork", "ลง gwork", "ติดตั้ง project-kit", or wants deterministic enforcement of tsc/commit-format/task-log rules instead of prompt-based rules.
---

# gwork — discipline enforced by the system, not by AI willpower

One principle: **any rule that can be checked deterministically becomes a hook/script that actually blocks.** CLAUDE.md keeps only judgment calls.

All source files live in this skill folder (`scripts/`, `githooks/`, `hooks/`, `commands/`, `CLAUDE.template.md`). Communicate with the user in their language. `e2e/` is the kit's own test harness — never copy it into a target repo; rerun it after changing any hook or script (see [e2e/README.md](e2e/README.md)).

## What is enforced by what

| Rule | Enforced by | If violated |
|---|---|---|
| tsc passes before push | `githooks/pre-push` | push blocked |
| commit format `type: desc`, no `@` | `githooks/commit-msg` | commit rejected |
| logged work must update INDEX (latest month) | `scripts/tasklog-check.mjs` in pre-push | push blocked |
| rotten/wrong-shard INDEX links · gotcha too long · BC rows carrying text | tasklog-check | push blocked |
| absolute prohibitions (`forbidden` patterns in gwork.json) | tasklog-check (check F) | push blocked — only the owner overrides, via gwork.json |
| read gotchas before touching a module | `hooks/tasklog-gotcha.mjs` (PreToolUse) | auto-injected |
| Evidence / Confidence gate / Clarify Early / subagents never commit | CLAUDE.md (prompt) | judgment |

## Install into a target repo

Let `<SKILL>` = this skill folder, `<REPO>` = the target repo.

1. **Create `gwork.json` at the repo root matching its structure** — copy from `gwork.example.json` and edit per [ADAPT.md](ADAPT.md).
   All rules (commit types, prepush checks, gotcha limits, module mapping) live in this one file; users edit it freely without touching code. No file = defaults (Osaki Hub Evo layout) · broken config = every gate fails loud.
2. **Copy the skeleton:**
   ```bash
   cp -r <SKILL>/githooks <REPO>/githooks
   mkdir -p <REPO>/scripts
   cp <SKILL>/scripts/tasklog-check.mjs <SKILL>/scripts/migrate.mjs <REPO>/scripts/
   cd <REPO> && git config core.hooksPath githooks
   ```
3. **task-log:**
   - Existing log (entries headed `## YYYY-MM-DD — title`): `node scripts/migrate.mjs "<log file>"` → produces `task-log/` (source file untouched)
   - None: create `task-log/INDEX.md` (empty table header `| Module | Entries (latest first) | BC | Gotcha (≤1 line) |`) + an empty `task-log/<YYYY-MM>.md`
4. **Slash commands (once per machine):** `cp <SKILL>/commands/*.md ~/.claude/commands/` → gives `/gwork-log` `/gwork-check` `/gwork-rule` `/gwork-status`
5. **PreToolUse hook (once per machine):** copy `hooks/tasklog-gotcha.mjs` → `~/.claude/hooks/` and add to `~/.claude/settings.json` (merge into existing hooks, don't overwrite):
   ```json
   "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit",
     "hooks": [{ "type": "command", "command": "node \"C:/Users/<USER>/.claude/hooks/tasklog-gotcha.mjs\"", "timeout": 15 }] } ]
   ```
   The hook finds `task-log/INDEX.md` by walking up from cwd — one global copy serves every repo with the kit installed.
6. **CLAUDE.md:** use `CLAUDE.template.md` as the skeleton — fill `<PROJECT_NAME>`, commands, SSOT, then **move long gotchas from the old CLAUDE.md into Known Bug Classes (one line per BC-xxx)**. Keep existing architecture/project specifics; cut only rules the hooks now enforce.

## Verify after install

```bash
node scripts/tasklog-check.mjs            # must be green
git commit --allow-empty -m "bad"         # must be blocked by commit-msg (then reset)
```
Test the hook: edit a file in a module that has a gotcha in INDEX → injection appears the first time, silent the second time.

## Boundaries

- **Never** commit/push on the repo owner's behalf during install — place the files, let the owner review.
- Phase 2 (blocking subagent commits, a Stop-hook task-log reminder) is **not built** — waiting for evidence from real usage first.
