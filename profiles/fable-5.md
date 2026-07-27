<!-- source: platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5 · checked: 2026-07-27 -->

- **`task-log/` is your memory** — one lesson per entry with why it mattered. Update an existing entry instead of duplicating it, delete what turns out to be wrong, and read the INDEX row before assuming anything about a module. It persists across sessions; your context doesn't.
- **Delegate freely and asynchronously** — keep working while subagents run, and on long runs use fresh-context verifier subagents against the spec. **Subagents never commit or push**: you review the diff and run validation yourself before committing.
- **Never stop on account of context budget.** Close out the current task into `task-log/` (that is the handoff surface) and keep going.
- The rules here are constraints, not a script — pick your own route inside them.
