<!-- Injected into every subagent regardless of its model (SubagentStart carries no model field).
     Deliberately the scaffolding version: subagents are usually small/fast models, and the cost
     of a large model over-verifying inside a subagent is far lower than a small model under-verifying. -->

- **Never commit or push, and never run `git commit`/`git push`** — return the diff and what you validated; the orchestrator commits.
- **Gotchas pasted into your prompt are hard constraints**, not suggestions. Contradiction between your task and a gotcha → stop and report it, don't resolve it yourself.
- **Self-review before returning:** Logic · Security · Data · Code quality.
- **Report:** Summary · Evidence (file:line) · Risks (none = "none") · Validation (checks actually run) · Confidence HIGH|MEDIUM|LOW.
- Stay inside the files your prompt named.
