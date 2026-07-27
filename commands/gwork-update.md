---
description: Update the gwork skill from origin and re-sync everything installed from it — machine-level files and this repo's copies
argument-hint: [--check]
---

Update gwork to the latest version. Updating is always user-invoked — never pull silently.
Communicate with the user in their language.

The skill at `~/.claude/skills/gwork` is the source; four sets of files are **copies** of it and
go stale when it moves: `~/.claude/commands/gwork-*.md`, `~/.claude/hooks/{tasklog-gotcha,model-profile}.mjs`,
`~/.claude/gwork-profiles/*.md`, and — in every repo where gwork is installed — `githooks/*` +
`scripts/tasklog-check.mjs` + `scripts/migrate.mjs`. A pull that skips the copies leaves a repo
enforcing the old rules.

## 1. Inspect first — change nothing

- `git -C ~/.claude/skills/gwork status --porcelain` → **not empty = stop.** Report the dirty files
  and ask what to do. Local edits are never discarded or stashed silently.
- `git -C ~/.claude/skills/gwork fetch -q origin` then `git -C ~/.claude/skills/gwork log --oneline HEAD..origin/main`
- Diff each machine-level copy against the skill's version: `commands/*.md`, `hooks/tasklog-gotcha.mjs`,
  `hooks/model-profile.mjs`, `profiles/*.md` → `~/.claude/gwork-profiles/`
- **Profile coverage:** list `profiles/*.md` against the models in use. A model with no profile file gets
  nothing injected (by design, never a guessed one) — report it as a gap to fill, not an error. Each profile
  header carries its `source:` URL and `checked:` date; flag any older than ~6 months as worth re-checking
  against the current prompting docs
- Is gwork installed in the current repo (`git config core.hooksPath` = `githooks`)? If yes, diff
  `githooks/commit-msg`, `githooks/pre-push`, `scripts/tasklog-check.mjs`, `scripts/migrate.mjs`
  against the skill's versions. If no, say so and skip the repo half entirely.

## 2. Report

A short table: commits behind + which copies are stale, grouped machine-level / this repo.
Quote file names and counts from the command output — never paraphrase them.

- Up to date and no stale copy → say so, stop.
- `--check` in `$ARGUMENTS` → stop here regardless.

## 3. Confirm, then apply

Ask with AskUserQuestion, listing the exact files that will be overwritten. After a yes:

1. `git -C ~/.claude/skills/gwork pull --ff-only origin main` — a non-fast-forward result is a stop,
   not a thing to force. Report it and let the user decide.
2. Copy `commands/*.md` → `~/.claude/commands/`, `hooks/tasklog-gotcha.mjs` + `hooks/model-profile.mjs` →
   `~/.claude/hooks/`, `profiles/*.md` → `~/.claude/gwork-profiles/` (a profile the user edited locally is
   a dirty copy — show the diff and ask, same rule as a dirty skill tree)
3. Repo copies (only if installed here): `githooks/*`, `scripts/tasklog-check.mjs`, `scripts/migrate.mjs`

**Never touch `gwork.json`** — per-repo tuning lives there and survives every update. If the new
version added keys, point the user at `ADAPT.md`; don't write them.

## 4. Verify and hand back

- `node scripts/tasklog-check.mjs` still green (repo case) — red after an update is a finding, report it verbatim
- PreToolUse for `tasklog-gotcha.mjs` still registered in `~/.claude/settings.json`; if `model-profile.mjs`
  is present, so are its five events (SessionStart · UserPromptSubmit · SubagentStart · PreToolUse · Stop)
  — a missing one is silent, not loud: the profile just never arrives
- `node e2e/tools/unit-model-profile.mjs` from the kit after any change to the profile hook
- Repo copies are an uncommitted working-tree change — say so and suggest `chore: update gwork kit to <short-sha>`;
  don't commit on the user's behalf
- Updated hooks and commands take effect after a **Claude Code session restart**; the old ones stay live until then

$ARGUMENTS
