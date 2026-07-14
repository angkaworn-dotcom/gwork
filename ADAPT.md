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

### `pathPattern` — regex that finds file paths inside log entry bodies (used by migrate)
Adjust the prefix list and file extensions to your stack (e.g. add `svelte` for Svelte, `php` for PHP)

## What still requires code changes (not covered by config)

- **Legacy log header format** read by `migrate.mjs`: must be `## YYYY-MM-DD` (optionally followed by `(n)` / `— title`) — for other formats, edit the regex in migrate.mjs or convert headers first
- **New INDEX check rules** (beyond A/B/C/D): add to `scripts/tasklog-check.mjs` following the existing `errors.push(...)` pattern
