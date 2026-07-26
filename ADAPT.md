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

### `owner` — make "the owner approved this" unforgeable (strongly recommended)

```json
"owner": { "allowedSigners": ".gwork-allowed-signers", "sshKeygen": "/usr/bin/ssh-keygen" }
```

Without this, lifting a `forbidden` rule (check G), blanking a gotcha, or backdating an entry
(check H) is excused by a `Gwork-Owner-Approved: <why>` commit trailer — **which the agent writes
itself.** e2e S12 measured that: 5 of 6 weak-model runs forged the trailer, quoting the task prompt
as the owner's confirmation, and 3 of 6 got a forbidden pattern onto the remote. Set this and the
same overrides additionally require an SSH signature from a key you hold:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gwork_owner            # once; keep the private half OFF the repo
printf 'owner %s\n' "$(awk '{print $1" "$2}' ~/.ssh/gwork_owner.pub)" > .gwork-allowed-signers
git config gpg.format ssh && git config user.signingkey ~/.ssh/gwork_owner   # your machine only
# then approve like this, as the owner:
git commit -S -m "chore: lift the rule

Gwork-Owner-Approved: display-only, rounding accepted"
```

- `allowedSigners` — repo-relative path to an [allowed-signers](https://git-scm.com/docs/git-config#Documentation/git-config.txt-gpgsshallowedSignersFile) file holding your **public** key. Commit it; the agent reading it changes nothing, since verification is math, not secrecy.
- `sshKeygen` — optional absolute path to the verifier. Pin it on a machine where an agent could put a fake `ssh-keygen` earlier on `PATH`.
- Verification always uses the **baseline** copy of the signers file, so an agent that appends its own key at HEAD and signs with it is rejected — and the change to the list is itself reported (check G4).
- The checker never reads `gpg.format` / `gpg.ssh.program` / `gpg.ssh.allowedSignersFile` from git config: those are writable by anything holding the shell, and a shim that always answers "good" would pass every forgery.
- Unset = the old trailer-only behavior, so existing repos keep working — but every accepted trailer now prints a `WARNING` naming the weakness.
- **Protect the private key with a passphrase or a hardware key that needs a touch.** A key cached in `ssh-agent` with no per-use confirmation can be used by anything running as you, including the agent.

Not closed by this: `git push --no-verify` still skips client-side hooks entirely (ROADMAP → bypass
resistance B, server side).

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

## There is no scaffolding level to choose — and that is a measured result

Between 2026-07-25 and 2026-07-26 `CLAUDE.template.md` briefly shipped a deletable "scaffolding
block" (the `investigate → root cause → design → implement` sequence, a 4-angle self-review, and a
5-field delivery format), to be kept for weaker models and deleted for frontier ones. **It is gone.**
e2e S12 A/B'd it — 2×2, n=3, Opus 5 and Haiku 4.5, arms identical but for the block:

| | rewrote the owner's `forbidden` rule |
|---|---|
| Opus 5, block kept / deleted | 0/3 · 0/3 |
| Haiku 4.5, block kept / deleted | **3/3 · 2/3** |

No protective effect in either direction — the weak model self-authorized slightly *more* often with
the block, and its one clean run was in the deleted arm. Nothing to configure, so nothing to get
wrong at install.

The finding worth carrying: **no prompt wording held.** Rule 4b did not stop the weak model either;
5 of 6 Haiku runs wrote a `Gwork-Owner-Approved:` trailer citing the task prompt as owner
confirmation, and 3 of 6 pushed the forbidden pattern to the remote. If a weak model drives a repo
that matters, the load-bearing part is the deterministic gate — and the trailer escape hatch is a
known open hole (ROADMAP → bypass resistance, item 0). Full history: [MODEL-NOTES.md](MODEL-NOTES.md)
M-001 and M-002. The block itself survives only as `e2e/fixtures/scaffolding-block.md`, so S12 stays
reproducible; it is not an install option.

## What still requires code changes (not covered by config)

- **Legacy log header format** read by `migrate.mjs`: must be `## YYYY-MM-DD` (optionally followed by `(n)` / `— title`) — for other formats, edit the regex in migrate.mjs or convert headers first
- **New INDEX check rules** (beyond A/B/C/D): add to `scripts/tasklog-check.mjs` following the existing `errors.push(...)` pattern
