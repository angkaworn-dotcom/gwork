# Adapting rules to your repo — edit `gwork.json`, one file

Place `gwork.json` at the repo root (copy from [gwork.example.json](gwork.example.json)) — **no hook/script code changes needed.**
Contract: missing file / missing key = defaults · file present but unparseable = every gate **fails loud** (commits/pushes blocked until fixed).

## All keys

### `commit.types` — allowed commit message types
```json
"commit": { "types": ["feat", "fix", "chore", "wip"] }
```
Git-generated messages (`Merge`/`Revert`/`fixup!`/`squash!`) always pass — no need to list them. The description after `type:` may be in any language.

### `prepush` — checks before push (run in order; any failure blocks the push)
```json
"prepush": ["npx tsc --noEmit", "node scripts/tasklog-check.mjs", "npm run test:run"]
```
Not a TypeScript repo? Swap in your stack's build/lint commands.

### `tasklog` — INDEX hygiene thresholds
```json
"tasklog": { "maxGotcha": 140, "bcGotchaMax": 80 }
```
`maxGotcha` = max length of the Gotcha column · `bcGotchaMax` = ceiling once the row has a BC (promote and trim)

Two more keys under `tasklog`, both read by `hooks/tasklog-gotcha.mjs`:
- `fileInjection`: `"fallback"` (default) — when the edited file's module has no INDEX row, inject the rows whose entries mention that file (by full path, or by bare filename when it is unique in the repo) · `"always"` — do both every time · `false` — module lookup only
- `unclosedCommits`: `3` (default) — at session start, say once when this many commits have landed since the last task-log entry · `0` turns it off

### Limits on a `forbidden` pattern
Patterns are JavaScript regular expressions, matched one line at a time. A pattern that nests one repetition inside another — `(a+)+`, `(\\w*)*` — is refused by `tasklog-check` and skipped by the edit hook: on a line that almost matches it can run for minutes. Rewrite it with a single level of repetition. The shell-write check sees redirects (`>`, `>>`, `>|`, `&>`), `tee`, `sed -i` and `perl -i`, and follows a leading `cd`; it does not see a file written by a script (`python -c`, `node -e`), copied in with `cp`, or named through a variable.

### `routing` — which model takes a subagent task (used by `hooks/model-route.mjs`)
```json
"routing": {
  "mode": "advise",
  "tiers": { "light": "haiku", "standard": "sonnet", "heavy": "opus" },
  "standardAt": 1, "heavyAt": 4,
  "risky": ["schema", "migrat", "payment"],
  "openEnded": ["investigat", "root cause"],
  "mechanical": ["typo", "rename", "\\bdocs?\\b"]
}
```
Every task handed to a subagent is scored from what it touches (see the hook's header for the signals) and placed in a tier. `mode`: `"advise"` (default) says so when the chosen model and the tier differ · `"block-once"` denies the mismatched call once with the recommendation · `"off"`, or `"routing": false`. `tiers` may name models or your own agent types (`worker-haiku`, `senior-sonnet`): the family is read from the name. The three word lists are regular expressions matched against the task statement; each replaces its default list.

The same judgment is available by hand: `node ~/.claude/hooks/model-route.mjs --task "<what is to be done>" [--files a b]`.

The word lists are starting points, not measured facts. The hook records what every subagent actually cost; `scripts/gwork-stats.mjs` prints tokens and tool calls per tier. Tune from that.

### `driftNotice` — the once-a-day copy check
```json
"driftNotice": false
```
At session start, once a day per repo, the gotcha hook runs `scripts/gwork-drift.mjs` from the kit (`$GWORK_KIT`, default `~/.claude/skills/gwork`) and says so when an installed copy is behind, was edited in place, or the kit holds uncommitted files. Silent when everything matches. `false` turns it off.

### `log` — the hooks' decision log
```json
"log": false
```
Every inject, pass and deny of the gotcha hook is appended to `~/.gwork/log/<YYYY-MM>.jsonl` (local only; read it with `scripts/gwork-stats.mjs`). `false` turns it off for this repo; `GWORK_LOG=0` turns it off for a shell.

### `forbidden` — absolute prohibitions as a hard gate (checked by tasklog-check in pre-push)
```json
"forbidden": [
  { "path": "^lib/money/", "pattern": "\\.toFixed\\(", "reason": "money display must use formatMoney()" }
]
```
- Any tracked file whose path matches `path` and contains a line matching `pattern` blocks the push (check F)
- Use this for "NEVER X in Y" gotchas — a rule the AI must not be able to trade away. **A direct order in a prompt is not authorization to violate one; only the repo owner overrides, by editing this list** (evidence: e2e S7 — under a conflicting explicit order, 0/3 agents honored a prompt-level gotcha)
- Default: none · both fields are JS regexes (double-escape: `\\.`)

### `modules` — path → module key mapping (shared by migrate and the gotcha hook)
```json
"modules": [
  { "pattern": "^src/([\\w-]+)/", "name": "svc:$1" },
  { "pattern": "^packages/([\\w-]+)/", "name": "pkg:$1" }
]
```
- Order matters — first match wins
- `$1`..`$9` reference capture groups · JSON regexes need double-escaped backslashes (`\\w`)
- Unmatched paths: migrate → `other`/`misc` rows · gotcha hook → silent (make sure folders with real gotchas are covered)
- This is the single rule set read by both `scripts/migrate.mjs` and `hooks/tasklog-gotcha.mjs` — the old two-copy sync problem is gone

### `profiles` / `profilesDir` — per-model rule injection (used by `hooks/model-profile.mjs`)
```json
"profiles": false,
"profilesDir": ".gwork/profiles"
```
- `profiles: false` turns the injection off for this repo · default: on
- `profilesDir` points at a folder of `<model>.md` files that **replaces** the machine-level set for this repo (relative to the repo root, or absolute). Lookup order: `$GWORK_PROFILES` → `profilesDir` → `<repo>/.gwork/profiles` → `~/.claude/gwork-profiles`
- File names are the model id minus the `claude-` prefix and any date suffix: `claude-haiku-4-5-20251001` → `haiku-4-5.md`. `subagent.md` is injected into every subagent regardless of model
- A model with no file gets **nothing injected** — never a guessed profile. Add the file when a new model ships

### `pathPattern` — regex that finds file paths inside log entry bodies (used by migrate)
Adjust the prefix list and file extensions to your stack (e.g. add `svelte` for Svelte, `php` for PHP)

## What still requires code changes (not covered by config)

- **Legacy log header format** read by `migrate.mjs`: must be `## YYYY-MM-DD` (optionally followed by `(n)` / `— title`) — for other formats, edit the regex in migrate.mjs or convert headers first
- **New INDEX check rules** (beyond A/B/C/D): add to `scripts/tasklog-check.mjs` following the existing `errors.push(...)` pattern
