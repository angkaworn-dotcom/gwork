---
name: gwork
description: Install the gwork discipline kit (git pre-push/commit-msg hooks, task-log INDEX checker, PreToolUse gotcha-injection hook, short CLAUDE.md template) into any git repository. Use when user says "install gwork", "setup discipline kit", "ติดตั้ง gwork", "ลง gwork", "ติดตั้ง project-kit", or wants deterministic enforcement of tsc/commit-format/task-log rules instead of prompt-based rules.
---

# gwork — discipline enforced by the system, not by AI willpower

One principle: **any rule that can be checked deterministically becomes a hook/script that actually blocks.** CLAUDE.md keeps only judgment calls.

All source files live in this skill folder (`scripts/`, `githooks/`, `hooks/`, `commands/`, `profiles/`, `CLAUDE.template.md`). Communicate with the user in their language. `e2e/` is the kit's own test harness — never copy it into a target repo; rerun it after changing any hook or script (see [e2e/README.md](e2e/README.md)). Field failures and their fixes live in [LESSONS.md](LESSONS.md) — **read its newest entries before an install**, and when the kit itself misbehaves follow the Self-repair protocol below.

What each hook/script enforces: the table in [README.md](README.md). Deterministic rules block (pre-push, commit-msg, tasklog-check); everything in CLAUDE.md and `profiles/` is prompt, never a gate.

## Install into a target repo

Let `<SKILL>` = this skill folder, `<REPO>` = the target repo.

1. **Create `gwork.json` at the repo root matching its structure** — copy from `gwork.example.json` and edit per [ADAPT.md](ADAPT.md).
   All rules (commit types, prepush checks, gotcha limits, module mapping) live in this one file; users edit it freely without touching code. No file = defaults (Osaki Hub Evo layout) · broken config = every gate fails loud.
2. **Run the installer** — it does every mechanical step and prints what is left:
   ```bash
   node <SKILL>/scripts/gwork-install.mjs --repo <REPO> --dry-run     # read what it would do
   node <SKILL>/scripts/gwork-install.mjs --repo <REPO>               # repo half
   node <SKILL>/scripts/gwork-install.mjs --repo <REPO> --machine     # once per machine: ~/.claude hooks, commands, profiles, settings.json
   ```
   Repo half: copies `githooks/{pre-push,commit-msg,pre-commit}` (executable) and `scripts/{tasklog-check,migrate}.mjs`, sets `core.hooksPath`, creates an empty `task-log/`, warns when `.gitignore` hides a copied file (L-002).
   Machine half: copies the two hooks, the slash commands and the profiles, and registers the hooks in `~/.claude/settings.json` — adding what is missing, leaving every other entry alone, keeping the previous file as `settings.json.gwork-bak`.
   It is idempotent, stages nothing, and **refuses** two things: a `core.hooksPath` that already points elsewhere, and a copy that was edited in place (exit 2 — that copy holds a fix the kit never received; move it into the kit first, L-008).
3. **Existing log?** (entries headed `## YYYY-MM-DD — title`) Delete the empty `task-log/` the installer made and run `node scripts/migrate.mjs "<log file>"` (source file untouched).
4. **Executable bit in the index:** after `git add githooks`, `git ls-files -s githooks` must show `100755` — git on Linux/macOS skips a non-executable hook with only a `hint:` line (L-006). From Windows: `git update-index --chmod=+x githooks/*`.
5. **What the machine half registers** (for reading `settings.json`, not for typing): `tasklog-gotcha.mjs` on `PreToolUse` (`Edit|Write|MultiEdit|Bash`) and `SessionStart`; `model-profile.mjs` on `SessionStart`, `UserPromptSubmit`, `SubagentStart`, `PreToolUse`, `Stop`, and `PostModelSwitch` when Claude Code is 2.1.251+ (why six: L-005, L-007). Per-repo opt-out of profiles: `"profiles": false` in gwork.json. Both are prompt-layer; neither is a gate except the two denies in the gotcha hook (forbidden content, sentinel).
6. **CLAUDE.md:** use `CLAUDE.template.md` as the skeleton — fill `<PROJECT_NAME>`, commands, SSOT, then **move long gotchas from the old CLAUDE.md into Known Bug Classes (one line per BC-xxx)**. Keep existing architecture/project specifics; cut only rules the hooks now enforce.
7. **Sentinel (optional, recommended when an agent runs the repo autonomously):** tamper-detector for the enforcement machinery itself — snapshots the hooks/checker/`core.hooksPath`/guards outside the repo and blocks a push (and denies edits) if any of them drifts from the owner's snapshot.
   Installation splits by trust: the **agent does the mechanics**, the **owner does the attestation** — `init`/`update` refuse from an agent shell (`CLAUDECODE` marker) even with the correct hash, precisely so an agent cannot attest to machinery it just modified.
   ```bash
   cp <SKILL>/scripts/gwork-sentinel.mjs <REPO>/scripts/
   node <REPO>/scripts/gwork-sentinel.mjs install              # copies to ~/.gwork/bin — agent-safe
   node <REPO>/scripts/gwork-sentinel.mjs init --repo <REPO>   # agent shell → refused + prints the owner one-liner
   ```
   The refusal prints a one-liner (`GWORK_SENTINEL_CONFIRM=<hash> … init`) — hand it to the owner verbatim to paste in **their own terminal**. The hash pins the exact bytes being attested: if anything changes between the agent preparing it and the owner running it, the hash mismatches and the command fails. On a real terminal, plain `init` with y/N works as before.
   After any legitimate change to the hooks or `gwork.json` guards, the owner re-runs `update` the same way. It closes silent machinery tampering (hooksPath removal, neutered checker); it does **not** close `git push --no-verify` — that needs the server side (see ROADMAP).

## Verify after install

```bash
node scripts/tasklog-check.mjs            # must be green
git commit --allow-empty -m "bad"         # must be blocked by commit-msg (then reset)
```
Test the hook: edit a file in a module that has a gotcha in INDEX → injection appears the first time, silent the second time.
`node <SKILL>/scripts/gwork-drift.mjs --repo <REPO>` must report every copy as matching. After a week of use, `node <SKILL>/scripts/gwork-stats.mjs` shows what the hooks actually delivered.
If the sentinel is installed, `node e2e/tools/unit.mjs` from the kit exercises it end-to-end (90 deterministic cases).

## Self-repair — the kit fixes itself when it breaks in the field

Iron rule: **a kit bug found during install or daily use is fixed at the source, in the same session — never patched only in the target repo.** Every field failure makes the kit permanently better; the lesson log is [LESSONS.md](LESSONS.md).

1. **Root-cause first** (evidence, not guess) — reproduce the failure minimally before touching anything
2. **Fix the source file in this skill folder**, then sync the fix to the installed copy in the repo you're working in (installed copies are deployments, not forks — never let them drift; add a code comment explaining the why)
3. **Append the lesson to `LESSONS.md`** (newest first): id `L-xxx` · date · repo found in · symptom · root cause · fix. If the failure was an install step (not a code bug), also update the install instructions above in the same session, citing the `L-xxx`
4. **Rerun the harness** when the changed file is covered: `node e2e/tools/unit.mjs` after touching the sentinel, hooks, or tasklog-check; full e2e per [e2e/README.md](e2e/README.md) for behavior changes. Changed file not covered → say so explicitly in the lesson
5. **Check for drift before any update:** `node scripts/gwork-drift.mjs --repo <REPO>` from the kit lists every installed copy that differs. `behind` is safe to overwrite; `local edit` is a fix that exists only in that copy — move it into the kit first (L-008)
6. **Sentinel repos:** if a repaired file is under a sentinel snapshot, pushes there will block until the owner re-runs `node scripts/gwork-sentinel.mjs update` — tell them, don't work around it

Self-repair boundary: it may fix bugs, silence false noise, and add checks — it must **never weaken enforcement** (removing/softening a gate, widening an escape hatch) without the owner's explicit ok in chat; that path stays governed by the gwork.json `forbidden` rules and check G.

## Boundaries

- **Never** commit/push on the repo owner's behalf during install — place the files, let the owner review.
- Phase 2 (blocking subagent commits, a Stop-hook task-log reminder) is **not built** — waiting for evidence from real usage first.
