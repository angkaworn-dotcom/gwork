---
name: gwork
description: Install the gwork discipline kit (git pre-push/commit-msg hooks, task-log INDEX checker, PreToolUse gotcha-injection hook, short CLAUDE.md template) into any git repository. Use when user says "install gwork", "setup discipline kit", "ติดตั้ง gwork", "ลง gwork", "ติดตั้ง project-kit", or wants deterministic enforcement of tsc/commit-format/task-log rules instead of prompt-based rules.
---

# gwork — discipline enforced by the system, not by AI willpower

One principle: **any rule that can be checked deterministically becomes a hook/script that actually blocks.** CLAUDE.md keeps only judgment calls.

All source files live in this skill folder (`scripts/`, `githooks/`, `hooks/`, `commands/`, `CLAUDE.template.md`). Communicate with the user in their language. `e2e/` is the kit's own test harness — never copy it into a target repo; rerun it after changing any hook or script (see [e2e/README.md](e2e/README.md)). Field failures and their fixes live in [LESSONS.md](LESSONS.md) — **read its newest entries before an install**, and when the kit itself misbehaves follow the Self-repair protocol below.

## What is enforced by what

| Rule | Enforced by | If violated |
|---|---|---|
| tsc passes before push | `githooks/pre-push` | push blocked |
| commit format `type: desc`, no `@` | `githooks/commit-msg` | commit rejected |
| logged work must update INDEX (latest month) | `scripts/tasklog-check.mjs` in pre-push | push blocked |
| rotten/wrong-shard INDEX links · gotcha too long · BC rows carrying text | tasklog-check | push blocked |
| absolute prohibitions (`forbidden` patterns in gwork.json) | tasklog-check (check F) | push blocked — only the owner overrides, via gwork.json |
| read gotchas before touching a module | `hooks/tasklog-gotcha.mjs` (PreToolUse) | auto-injected |
| Evidence / Confidence gate / Clarify Early / subagents never commit | CLAUDE.md (prompt) | judgment |

## Install into a target repo

Let `<SKILL>` = this skill folder, `<REPO>` = the target repo.

1. **Create `gwork.json` at the repo root matching its structure** — copy from `gwork.example.json` and edit per [ADAPT.md](ADAPT.md).
   All rules (commit types, prepush checks, gotcha limits, module mapping) live in this one file; users edit it freely without touching code. No file = defaults (Osaki Hub Evo layout) · broken config = every gate fails loud.
2. **Copy the skeleton:**
   ```bash
   cp -r <SKILL>/githooks <REPO>/githooks
   mkdir -p <REPO>/scripts
   cp <SKILL>/scripts/tasklog-check.mjs <SKILL>/scripts/migrate.mjs <REPO>/scripts/
   cd <REPO> && git config core.hooksPath githooks
   ```
   Check the repo's `.gitignore` covers none of the copied paths (`git check-ignore scripts/tasklog-check.mjs githooks/pre-push task-log/INDEX.md`) — a repo that ignores `/scripts/` silently unstages the checker (L-002: dir-level ignore also defeats `!negation`; change to `/scripts/*` + `!/scripts/tasklog-check.mjs`).
3. **task-log:**
   - Existing log (entries headed `## YYYY-MM-DD — title`): `node scripts/migrate.mjs "<log file>"` → produces `task-log/` (source file untouched)
   - None: create `task-log/INDEX.md` (empty table header `| Module | Entries (latest first) | BC | Gotcha (≤1 line) |`) + an empty `task-log/<YYYY-MM>.md`
4. **Slash commands (once per machine):** `cp <SKILL>/commands/*.md ~/.claude/commands/` → gives `/gwork-log` `/gwork-check` `/gwork-rule` `/gwork-status`
5. **PreToolUse hook (once per machine):** copy `hooks/tasklog-gotcha.mjs` → `~/.claude/hooks/` and add to `~/.claude/settings.json` (merge into existing hooks, don't overwrite):
   ```json
   "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit",
     "hooks": [{ "type": "command", "command": "node \"C:/Users/<USER>/.claude/hooks/tasklog-gotcha.mjs\"", "timeout": 15 }] } ]
   ```
   The hook finds `task-log/INDEX.md` by walking up from cwd — one global copy serves every repo with the kit installed.
6. **CLAUDE.md:** use `CLAUDE.template.md` as the skeleton — fill `<PROJECT_NAME>`, commands, SSOT, then **move long gotchas from the old CLAUDE.md into Known Bug Classes (one line per BC-xxx)**. Keep existing architecture/project specifics; cut only rules the hooks now enforce.
7. **Sentinel (optional, recommended when an agent runs the repo autonomously):** tamper-detector for the enforcement machinery itself — snapshots the hooks/checker/`core.hooksPath`/guards outside the repo and blocks a push (and denies edits) if any of them drifts from the owner's snapshot. As the **owner**, on a terminal:
   ```bash
   cp <SKILL>/scripts/gwork-sentinel.mjs <REPO>/scripts/
   node <REPO>/scripts/gwork-sentinel.mjs install            # copies to ~/.gwork/bin
   node <REPO>/scripts/gwork-sentinel.mjs init --repo <REPO>  # interactive y/N snapshot
   ```
   After any legitimate change to the hooks or `gwork.json` guards, re-run `node scripts/gwork-sentinel.mjs update` (interactive) to re-snapshot. It closes silent machinery tampering (hooksPath removal, neutered checker); it does **not** close `git push --no-verify` — that needs the server side (see ROADMAP).

## Verify after install

```bash
node scripts/tasklog-check.mjs            # must be green
git commit --allow-empty -m "bad"         # must be blocked by commit-msg (then reset)
```
Test the hook: edit a file in a module that has a gotcha in INDEX → injection appears the first time, silent the second time.
If the sentinel is installed, `node e2e/tools/unit.mjs` from the kit exercises it end-to-end (15 deterministic cases).

## Self-repair — the kit fixes itself when it breaks in the field

Iron rule: **a kit bug found during install or daily use is fixed at the source, in the same session — never patched only in the target repo.** Every field failure makes the kit permanently better; the lesson log is [LESSONS.md](LESSONS.md).

1. **Root-cause first** (evidence, not guess) — reproduce the failure minimally before touching anything
2. **Fix the source file in this skill folder**, then sync the fix to the installed copy in the repo you're working in (installed copies are deployments, not forks — never let them drift; add a code comment explaining the why)
3. **Append the lesson to `LESSONS.md`** (newest first): id `L-xxx` · date · repo found in · symptom · root cause · fix. If the failure was an install step (not a code bug), also update the install instructions above in the same session, citing the `L-xxx`
4. **Rerun the harness** when the changed file is covered: `node e2e/tools/unit.mjs` after touching the sentinel, hooks, or tasklog-check; full e2e per [e2e/README.md](e2e/README.md) for behavior changes. Changed file not covered → say so explicitly in the lesson
5. **Sentinel repos:** if a repaired file is under a sentinel snapshot, pushes there will block until the owner re-runs `node scripts/gwork-sentinel.mjs update` — tell them, don't work around it

Self-repair boundary: it may fix bugs, silence false noise, and add checks — it must **never weaken enforcement** (removing/softening a gate, widening an escape hatch) without the owner's explicit ok in chat; that path stays governed by the gwork.json `forbidden` rules and check G.

## Boundaries

- **Never** commit/push on the repo owner's behalf during install — place the files, let the owner review.
- Phase 2 (blocking subagent commits, a Stop-hook task-log reminder) is **not built** — waiting for evidence from real usage first.
