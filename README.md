# gwork — discipline kit for AI coding agents

Deterministic rules enforced by git hooks and Claude Code hooks, not prompts. **Blocked push > polite reminder.**

One principle: **any rule that can be checked deterministically becomes a hook/script that actually blocks.** CLAUDE.md keeps only judgment calls.

## What is enforced by what

| Rule | Enforced by | If violated |
|---|---|---|
| tsc passes before push | `githooks/pre-push` | push blocked |
| commit format `type: desc`, no `@` (Merge/Revert exempt) | `githooks/commit-msg` | commit rejected |
| logged work must update INDEX (latest month) | `scripts/tasklog-check.mjs` in pre-push | push blocked |
| rotten/wrong-shard INDEX links · gotcha too long · BC rows carrying text | tasklog-check | push blocked |
| read gotchas before touching a module | `hooks/tasklog-gotcha.mjs` (PreToolUse) | auto-injected — the AI never has to remember |
| Evidence / Confidence gate / Clarify Early / subagents never commit | `CLAUDE.template.md` (prompt) | judgment — can't be automated |

## Use as a Claude Code skill

```bash
git clone https://github.com/angkaworn-dotcom/gwork.git ~/.claude/skills/gwork
```

Then tell Claude Code to **"install gwork"** in your target repo — full steps in [SKILL.md](SKILL.md), per-project rule tuning in [ADAPT.md](ADAPT.md).

### Slash commands (copy `commands/*.md` → `~/.claude/commands/`)

| Command | What it does |
|---|---|
| `/gwork` | install the kit into the current repo |
| `/gwork-log` | close out a task: write the entry + update INDEX in one commit |
| `/gwork-check` | health-check the task-log and fix whatever is red |
| `/gwork-rule <rule>` | add/change a rule — routes it to gwork.json / code / CLAUDE.md automatically |
| `/gwork-status` | report install state + active config + log health |

## Manual install (without the skill)

```bash
# 1. copy the skeleton
cp -r githooks <repo>/githooks
cp scripts/tasklog-check.mjs scripts/migrate.mjs <repo>/scripts/
cd <repo> && git config core.hooksPath githooks

# 2. existing log → migrate (create gwork.json from gwork.example.json first — see ADAPT.md)
node scripts/migrate.mjs "update task.md"
# no log → create task-log/INDEX.md (table header) + an empty task-log/<YYYY-MM>.md

# 3. gotcha-injection hook (once per machine)
cp hooks/tasklog-gotcha.mjs ~/.claude/hooks/
# then register PreToolUse in ~/.claude/settings.json:
```
```json
"hooks": { "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit",
  "hooks": [{ "type": "command", "command": "node \"<ABS>/.claude/hooks/tasklog-gotcha.mjs\"" }] } ] }
```

## Configure rules freely at `gwork.json`

Every rule is editable at `gwork.json` in the repo root without touching code — commit types, pre-push check list, gotcha length limits, and the path→module mapping (one shared set used by both migrate and the gotcha hook). Full example at [gwork.example.json](gwork.example.json), every key documented in [ADAPT.md](ADAPT.md).
No file = defaults · unparseable config = every gate fails loud, never a silent fallback.

**Language:** tooling and docs are English; your data is yours — log entries, gotchas, INDEX content, and commit descriptions work in any language (the scripts parse structure, not prose).

## e2e tests

Agent-in-the-loop scenarios (commit format, close-out+push, gotcha compliance, bypass
pressure, buried gotcha, broken-log repair, conflicting orders) with deterministic
scoring — see [e2e/README.md](e2e/README.md). Rerun after any change to hooks or scripts.

## Phase 2 (waiting for evidence from real usage)

- PreToolUse blocking `git commit` in subagent contexts
- Stop hook warning when a turn edited code but logged nothing (currently guarded only at pre-push)
