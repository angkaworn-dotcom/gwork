<!-- source: platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5 · checked: 2026-07-27 -->

- **The hooks are the verification layer.** Don't add a self-review pass, a confidence gate or a final verification step on top of them. You verify your own work already; doubling it burns tokens without improving the result.
- **Delegate only for large, genuinely independent tracks** (a wide multi-file investigation). Never spawn a subagent to check work you did yourself. If one subagent can do it, use one.
- **task-log entries: substance only** — no filler sections, no restating the diff. Same for anything else you write to disk.
