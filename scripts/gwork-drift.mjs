#!/usr/bin/env node
/**
 * gwork-drift.mjs — which installed copies differ from the kit, and in which direction.
 * Every install is a set of COPIES (repo: githooks/*, scripts/*; machine: ~/.claude/hooks,
 * ~/.claude/commands, ~/.claude/gwork-profiles). A copy can differ for two opposite reasons,
 * and only one of them is safe to overwrite:
 *   behind      — identical to an older kit version → an update brings it forward
 *   local edit  — matches no kit version → someone fixed it in place; updating would DELETE
 *                 that fix. Upstream it first (Self-repair protocol, LESSONS L-008).
 *   differs     — the kit is a shallow clone, so its older versions are not there to compare
 *                 with: behind and edited cannot be told apart. `git fetch --unshallow` in the kit.
 * Reports only — changes nothing. Runs from the kit, never copied into a target repo.
 *
 * Usage: node <kit>/scripts/gwork-drift.mjs [--repo <path>] [--json]
 *   exit 0 = every copy matches the kit · 1 = at least one copy is behind, edited or missing
 * GWORK_CLAUDE_HOME overrides ~/.claude (tests, sandboxes).
 */
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : undefined }
const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(opt('repo') ?? process.cwd())
const CLAUDE = process.env.GWORK_CLAUDE_HOME ?? join(homedir(), '.claude')

const git = (cwd, ...a) => {
  try { return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null }
}
// CRLF-normalised: a checkout with autocrlf is the same file, not a drifted one
const norm = (s) => s.replace(/\r\n/g, '\n')
const sha = (s) => createHash('sha256').update(norm(s)).digest('hex')
const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }

// every version of a kit file that was ever committed → short sha of the commit that had it
const history = new Map()
const versionsOf = (kitRel) => {
  if (history.has(kitRel)) return history.get(kitRel)
  const map = new Map()
  for (const c of (git(KIT, 'log', '--format=%h', '--', kitRel) ?? '').split('\n').filter(Boolean)) {
    const blob = git(KIT, 'show', `${c}:${kitRel}`)
    if (blob !== null && !map.has(sha(blob))) map.set(sha(blob), c)
  }
  history.set(kitRel, map)
  return map
}

// A shallow kit (CI checkout, `git clone --depth 1`) has no older versions to match against.
// Calling every differing copy a "local edit" there would be a false alarm, so say what is known.
// The same holds for a kit that is not a git checkout at all (a copied folder): no history, no verdict.
// "git works here" is not enough: a copied kit sitting inside some other repository answers every
// git question with that repository's history. The kit has history only if it is the top of its own checkout.
const real = (p) => { try { return realpathSync(p) } catch { return p } }
const kitTop = git(KIT, 'rev-parse', '--show-toplevel')?.trim()
const SHALLOW = !kitTop || real(kitTop) !== real(KIT) || git(KIT, 'rev-parse', '--is-shallow-repository')?.trim() !== 'false'
const rows = []
const compare = (group, kitRel, installed, { optional = false } = {}) => {
  const kit = read(join(KIT, kitRel))
  if (kit === null) return // not part of this kit version
  const got = read(installed)
  if (got === null) { if (!optional) rows.push({ group, file: kitRel, state: 'missing', detail: installed }); return }
  if (sha(got) === sha(kit)) { rows.push({ group, file: kitRel, state: 'same' }); return }
  const old = versionsOf(kitRel).get(sha(got))
  rows.push(old
    ? { group, file: kitRel, state: 'behind', detail: `matches kit ${old}` }
    : SHALLOW
      ? { group, file: kitRel, state: 'differs', detail: 'kit has no full git history — cannot tell behind from edited (use a full clone of the kit)' }
      : { group, file: kitRel, state: 'local edit', detail: 'matches no kit version — upstream it before updating' })
}

// --- repo copies (only where gwork is installed) ---
const hooksPath = git(REPO, 'config', 'core.hooksPath')?.trim() ?? ''
const repoInstalled = existsSync(join(REPO, 'githooks', 'pre-push')) || existsSync(join(REPO, 'scripts', 'tasklog-check.mjs'))
// another checkout of the kit (a dev clone) carries githooks/ and scripts/ as SOURCE, not as an
// install — judging it as one reported a missing core.hooksPath that was never meant to be set
const isKitCheckout = existsSync(join(REPO, 'SKILL.md')) && existsSync(join(REPO, 'scripts', 'gwork-drift.mjs'))
if (repoInstalled && !isKitCheckout) {
  for (const f of ['githooks/pre-push', 'githooks/commit-msg', 'scripts/tasklog-check.mjs']) compare('repo', f, join(REPO, f))
  for (const f of ['githooks/pre-commit', 'scripts/migrate.mjs', 'scripts/gwork-sentinel.mjs']) compare('repo', f, join(REPO, f), { optional: true })
  if (!/(^|[\\/])githooks$/.test(hooksPath)) rows.push({ group: 'repo', file: 'core.hooksPath', state: 'missing', detail: `is "${hooksPath}" — the hooks never run` })
  if (process.platform !== 'win32') for (const h of ['pre-push', 'commit-msg', 'pre-commit']) {
    const p = join(REPO, 'githooks', h)
    if (existsSync(p) && !(statSync(p).mode & 0o111)) rows.push({ group: 'repo', file: `githooks/${h}`, state: 'not executable', detail: 'git skips it with only a hint' })
  }
}

// --- machine copies ---
for (const f of ['tasklog-gotcha.mjs', 'model-profile.mjs', 'model-route.mjs']) compare('machine', `hooks/${f}`, join(CLAUDE, 'hooks', f), { optional: f !== 'tasklog-gotcha.mjs' })
const list = (dir, re) => { try { return readdirSync(join(KIT, dir)).filter(f => re.test(f)) } catch { return [] } }
const hasAny = (dir) => { try { return readdirSync(dir).length > 0 } catch { return false } }
if (hasAny(join(CLAUDE, 'gwork-profiles'))) for (const f of list('profiles', /\.md$/)) compare('machine', `profiles/${f}`, join(CLAUDE, 'gwork-profiles', f))
for (const f of list('commands', /\.md$/)) compare('machine', `commands/${f}`, join(CLAUDE, 'commands', f))

const drift = rows.filter(r => r.state !== 'same')
// The kit itself can hold work that never left the machine: lessons and fixes written into an
// installed skill clone and not committed (L-010). Reported, not counted — a kit under
// development is legitimately dirty.
const kitDirty = kitTop && real(kitTop) === real(KIT) ? (git(KIT, 'status', '--porcelain') ?? '').split('\n').filter(Boolean).map(l => l.slice(3)) : []
const kitHead = (kitTop && real(kitTop) === real(KIT) ? git(KIT, 'rev-parse', '--short', 'HEAD')?.trim() : null) ?? 'no git history'
if (args.includes('--json')) {
  console.log(JSON.stringify({ kit: KIT, kitHead, repo: repoInstalled && !isKitCheckout ? REPO : null, checked: rows.length, drift, kitDirty }))
} else {
  console.log(`gwork-drift — kit ${kitHead} · ${rows.length} copies checked${repoInstalled && !isKitCheckout ? '' : ' · no install in this repo'}`)
  for (const r of drift) console.log(`  ${r.state.padEnd(14)} ${r.group.padEnd(8)} ${r.file}${r.detail ? '  — ' + r.detail : ''}`)
  if (kitDirty.length) console.log(`  kit has ${kitDirty.length} uncommitted file(s): ${kitDirty.slice(0, 4).join(', ')}${kitDirty.length > 4 ? ', …' : ''} — a lesson or fix written here reaches nobody until it is committed and pushed`)
  if (!drift.length) console.log('  every copy matches the kit')
  else if (drift.some(r => r.state === 'local edit')) console.log('  local edits are fixes the kit never received: move them into the kit before any update overwrites them')
}
process.exit(drift.length ? 1 : 0)
