<!-- source: platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5 · checked: 2026-07-27
     field-report overrides (r/Anthropic, 2026-07): opus-5 self-verification observed unreliable on
     logic-heavy work — two rules below deliberately deviate from the official guide; re-check on next model rev -->

- **The hooks are the verification layer for what they cover** (tsc, commit format, task-log). Don't add a self-review pass, a confidence gate or a final verification step on top of them — but hooks never see runtime behavior: for logic-heavy work, run the real test and claim done only from its output. Evidence instead of claims, not review on top of review.
- **Delegate only for large, genuinely independent tracks** (a wide multi-file investigation). Don't spawn a subagent to re-check your own work — except when the change touches schema, permissions, or a multi-step flow: there, one fresh-context verifier against the spec is allowed. If one subagent can do it, use one.
- **task-log entries: substance only** — no filler sections, no restating the diff. Same for anything else you write to disk.
