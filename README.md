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
| absolute prohibitions (`forbidden` patterns in gwork.json) | tasklog-check (check F) | push blocked — a prompt-level order is not an override; only the repo owner is, via gwork.json |
| read gotchas before touching a module | `hooks/tasklog-gotcha.mjs` (PreToolUse) | auto-injected — the AI never has to remember |
| Evidence / Clarify Early / design decisions belong to the owner / subagents never commit | `CLAUDE.template.md` (prompt) | judgment — can't be automated |
| rules that differ per model (delegation, task-log-as-memory, small-model scaffolding) | `hooks/model-profile.mjs` + `profiles/<model>.md` | judgment — injected for the running model, never blocking |

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
| `/gwork-import <path>` | bulk-import rules from an old CLAUDE.md or any rules file — classify, dedupe, route as one reviewed batch |
| `/gwork-status` | report install state + active config + log health |
| `/gwork-update` | pull the latest kit and re-sync every copy made from it (machine files + this repo's hooks/scripts) |

## Use with Hermes Agent

The deterministic core (git hooks, tasklog-check, `forbidden` gate) is agent-agnostic
and needs nothing. The gotcha hook and the slash commands have Hermes counterparts in
[`hermes/`](hermes/README.md) — a `pre_tool_call` shell hook (block-once delivery) and
five `SKILL.md` skills. Verified against hermes-agent's real hook dispatcher plus a
live model loop (e2e S10, 3/3).

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
  "hooks": [{ "type": "command", "command": "node \"<ABS>/.claude/hooks/tasklog-gotcha.mjs\"", "timeout": 15 }] } ] }
```

## Per-model profiles

CLAUDE.md carries what every model needs; `profiles/<model>.md` carries what only one of them does — because the guidance genuinely conflicts. Opus 5 is told not to use subagents to verify its own work; Fable 5 is told to delegate freely and use verifier subagents on long runs; small models keep the self-review scaffolding that makes large models over-verify. `hooks/model-profile.mjs` injects the file matching the model actually running (including after a mid-session `/model` switch) and nothing else. Unknown model = nothing injected.

Everything the agent harness already handles per model — response length, scope, progress updates, self-correction — is deliberately **absent** from both layers. Repeating it there costs tokens and causes over-verification.

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
