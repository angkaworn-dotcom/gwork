# gwork on Hermes Agent

Adapter layer for running gwork under [Hermes Agent](https://github.com/NousResearch/hermes-agent)
(Nous Research). The deterministic core needs **no changes** — only the two
Claude-Code-specific pieces have Hermes counterparts here.

## What ports how

| gwork layer | On Hermes | Work needed |
|---|---|---|
| git hooks (pre-push, commit-msg) + tasklog-check + `forbidden` gate + `gwork.json` | Hermes's terminal tool runs real shell subprocesses — git hooks fire exactly as for a human | **none** |
| `CLAUDE.template.md` | Hermes auto-loads `CLAUDE.md` as a context file (`agent/coding_context.py`) | **none** |
| gotcha-injection hook | `hooks/tasklog-gotcha-hermes.mjs` — Hermes shell hook on `pre_tool_call` | install (below) |
| slash commands | `skills/gwork-*/SKILL.md` — Hermes skills, invoked as `/gwork-log` etc. | install (below) |

## Semantics difference: block-once instead of inject

Hermes's `pre_tool_call` hook can **block** a tool call but cannot inject context
(injection exists only at `pre_llm_call`, which is too early to know which file is
being edited). So the adapter flips the mechanism: the first `write_file`/`patch`
into a module that has a gotcha is **blocked once, with the gotcha text as the block
reason**; the agent reads the reason and re-issues the call, which passes. The model
cannot skip the gotcha, because the tool result *is* the gotcha — in practice this is
stronger than Claude Code's advisory `additionalContext`. Evidence: e2e S10.

## Install (once per machine)

1. Repo-side install is identical to the main [SKILL.md](../SKILL.md) steps 1–4
   (githooks, scripts, task-log, CLAUDE.md) — nothing Hermes-specific.
2. Gotcha hook:

   ```bash
   mkdir -p ~/.hermes/agent-hooks
   cp hooks/tasklog-gotcha-hermes.mjs ~/.hermes/agent-hooks/
   ```

   Then add to `~/.hermes/config.yaml` (absolute path; `shlex`-split, no shell):

   ```yaml
   hooks:
     pre_tool_call:
       - matcher: "write_file|patch"
         command: "node /home/you/.hermes/agent-hooks/tasklog-gotcha-hermes.mjs"
   ```

   First fire prompts for consent (or set `hooks_auto_accept: true` /
   `HERMES_ACCEPT_HOOKS=1` for headless runs). Requires node on the machine or
   container Hermes runs in.
3. Skills: `cp -r skills/gwork-* ~/.hermes/skills/`
4. Verify: `hermes hooks list` shows the hook; `hermes hooks test pre_tool_call
   --for-tool write_file` fires it with a synthetic payload.

## e2e evidence (2026-07-15)

- Adapter driven through Hermes's real dispatcher (`agent/shell_hooks.py`
  `register_from_config` → matcher → consent → subprocess → aggregation, the same
  path `hermes_cli/main.py` uses): 4/4 — gotcha module blocked with full message,
  same-session retry allowed, no-gotcha module silent, `terminal` tool untouched by
  the matcher.
- Live behavioral loop (S10: deepseek-v4-flash driving Hermes's exact tool contract,
  block returned as `{"error": ...}` exactly like `model_tools.py`): 3/3 — block →
  immediate retry → gotcha followed (`formatMoney()`, zero `.toFixed()`), task-log
  updated. Runner: `e2e/tools/hermes-sim-agent.mjs`.

Not yet tested: a full `pip install hermes-agent` live session with the Hermes models
themselves — the dispatcher and tool contract are exercised for real above, but model
behavior was proven with DeepSeek as the stand-in.
