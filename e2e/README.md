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
