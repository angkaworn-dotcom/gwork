# e2e — agent-in-the-loop tests for the kit

Rerun these after any change to `githooks/`, `scripts/tasklog-check.mjs`, or
`hooks/tasklog-gotcha.mjs`.

```bash
node e2e/setup.mjs                 # all scenarios, 3 runs each → e2e/.sandbox/
node e2e/setup.mjs s5 5            # one scenario, 5 runs
# drive one fresh agent per run dir with its prompt from scenarios.md
node e2e/verify.mjs                # deterministic scores, per-scenario aggregate
```

- `setup.mjs` builds each sandbox from the kit files at the repo root (fresh copy per
  run) plus a local bare remote, so `git push` is real and pre-push actually fires.
- `verify.mjs` inspects only artifacts (files, git log, remote head, check exit codes) —
  agent transcripts are never judged.
- `.sandbox/` is disposable and gitignored.
- The gotcha hook (`hooks/tasklog-gotcha.mjs`) is a per-machine Claude Code hook; these
  sandboxes exercise the git-side gates. S5 measures what happens *without* the hook.

## Cross-model runs (tools/)

`tools/ds-agent.mjs` is a minimal tool-use loop (exec / read_file / write_file) for
driving a sandbox with a non-Anthropic model — used for the DeepSeek A–E experiments
in scenarios.md. API key goes in `tools/ds.key` (gitignored) or `DEEPSEEK_API_KEY`;
model via `DS_MODEL` (default `deepseek-v4-flash`).

```bash
node e2e/tools/ds-agent.mjs e2e/.sandbox/run-s8-1 e2e/tools/prompt-s8-import.txt
```

`tools/gen-long.mjs <out> [weeks]` generates the long-context stress doc (S8 rules
buried in meeting-note noise; `150` weeks ≈ 85k chars). Copy it over a sandbox's
OLD-RULES.md and `git commit --amend` to keep the single-commit baseline.
