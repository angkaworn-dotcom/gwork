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

### `pathPattern` — regex that finds file paths inside log entry bodies (used by migrate)
Adjust the prefix list and file extensions to your stack (e.g. add `svelte` for Svelte, `php` for PHP)

## Scaffolding level — one choice inside CLAUDE.md (not `gwork.json`)

`CLAUDE.template.md` ships one block fenced by `▼▼ SCAFFOLDING BLOCK` / `▲▲ END SCAFFOLDING BLOCK`,
holding three verification instructions: the `investigate → root cause → design → implement` sequence,
the 4-angle self-review before push, and the 5-field final delivery format. **Decide once, at install
step 6, by which model drives the repo:**

| Model driving the repo | Do this |
|---|---|
| Frontier (Opus 5 class) | **delete the block** — the model already does this; keeping it buys over-verification and long reports |
| Weaker / older / small local models — incl. deepseek-v4-flash | **keep it** |
| Mixed, or you don't know yet | **keep it** — the cost of keeping is length; the failure mode of removing is silent self-authorization |

The block declares that it outranks the template's **Output discipline** section, so keeping it is
internally consistent — no further edits needed either way.

**Status: measured, and the block showed no protective effect.** S12 ran the A/B on 2026-07-26
(2×2, n=3 — Opus 5 and Haiku 4.5, block kept vs deleted, everything else identical). Opus was
unaffected either way. Haiku rewrote the owner's `forbidden` rule **3/3 with the block and 2/3
without it**, and its one clean run was in the deleted-block arm. So "keep it for weaker models"
is a conservative default with **no evidence behind it** — not the finding it was first written as.

What S12 did establish is that no prompt line held: rule 4b did not stop the weak model either, and
5/6 Haiku runs forged a `Gwork-Owner-Approved:` trailer to authorize themselves. If you are running
a weak model on a repo that matters, the load-bearing part is the deterministic gate, not this block —
and the trailer escape hatch is a known open hole (ROADMAP → bypass resistance, item 0).

Full reasoning for every line the template cut, kept, and added: [MODEL-NOTES.md](MODEL-NOTES.md) (M-001) —
read it before putting any removed line back.

## What still requires code changes (not covered by config)

- **Legacy log header format** read by `migrate.mjs`: must be `## YYYY-MM-DD` (optionally followed by `(n)` / `— title`) — for other formats, edit the regex in migrate.mjs or convert headers first
- **New INDEX check rules** (beyond A/B/C/D): add to `scripts/tasklog-check.mjs` following the existing `errors.push(...)` pattern
