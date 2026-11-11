#!/usr/bin/env node
/**
 * gwork-install.mjs — one command for the mechanical part of an install.
 * The install used to be 22 manual actions read from SKILL.md, with nothing checking that all
 * of them happened; the worst field defect (hooks without the executable bit) was a skipped
 * step nobody could see. This does the copies, the mode, core.hooksPath and the settings.json
 * registration, idempotently, and prints what is left for a person to decide.
 *
 * Usage (run out of the kit):
 *   node <kit>/scripts/gwork-install.mjs [--repo <path>]            repo half only
 *   node <kit>/scripts/gwork-install.mjs --machine [--repo <path>]  + ~/.claude hooks, commands, profiles, settings.json
 *   node <kit>/scripts/gwork-install.mjs --machine-only             the machine half alone (no repo needed)
 *   --dry-run   print every action, change nothing        --force   overwrite a copy edited in place
 *   --ci        also place .github/workflows/gwork-check.yml — the server-side check that
 *               `git push --no-verify` cannot skip (the owner still has to require it)
 *
 * What it will NOT do, by design:
 *   - overwrite a copy that matches no kit version (a fix made in place) without --force
 *   - replace a core.hooksPath that points somewhere else
 *   - write gwork.json or CLAUDE.md (project judgment), or stage/commit anything
 *   - attest the sentinel (the owner's act, never an agent's)
 * GWORK_CLAUDE_HOME overrides ~/.claude (tests, sandboxes).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { git } from './gwork-lib.mjs'

const args = process.argv.slice(2)
const has = (name) => args.includes(`--${name}`)
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : undefined }
const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(opt('repo') ?? process.cwd())
const CLAUDE = process.env.GWORK_CLAUDE_HOME ?? join(homedir(), '.claude')
const DRY = has('dry-run'), FORCE = has('force'), MACHINE_ONLY = has('machine-only'), MACHINE = has('machine') || MACHINE_ONLY

const done = [], skipped = [], todo = []
// a step that cannot be done (read-only directory, a file where a directory should be) stops the
// install with the reason, not a stack trace
const act = (what, fn) => {
  if (!DRY) { try { fn() } catch (e) { console.error(`gwork-install: could not ${what} — ${e.message}`); process.exit(1) } }
  done.push(what)
}

// which existing copies were edited in place — the drift detector already knows
const driftRun = spawnSync('node', [join(KIT, 'scripts', 'gwork-drift.mjs'), '--repo', REPO, '--json'], { encoding: 'utf8', env: process.env })
// "differs" = a shallow kit that cannot rule out an in-place fix: treated as edited, because
// overwriting a real fix is the one mistake this installer exists to prevent
const edited = new Map()
try { for (const r of JSON.parse(driftRun.stdout).drift) if (r.state === 'local edit' || r.state === 'differs') edited.set(`${r.group}:${r.file}`, r.state) } catch { /* no report = treat nothing as edited */ }

const same = (a, b) => { try { return readFileSync(a, 'utf8').replace(/\r\n/g, '\n') === readFileSync(b, 'utf8').replace(/\r\n/g, '\n') } catch { return false } }
const place = (group, kitRel, dest, { exec = false } = {}) => {
  const src = join(KIT, kitRel)
  if (!existsSync(src)) return
  if (existsSync(dest) && same(src, dest)) {
    if (exec && process.platform !== 'win32' && !(statSync(dest).mode & 0o111)) act(`make executable: ${dest}`, () => chmodSync(dest, 0o755))
    return
  }
  if (existsSync(dest) && edited.has(`${group}:${kitRel}`) && !FORCE) {
    skipped.push(edited.get(`${group}:${kitRel}`) === 'differs'
      ? `${dest} — differs from the kit, and the kit is a shallow clone, so it cannot be told whether this copy is merely old or was edited in place. Run \`git fetch --unshallow\` in the kit and retry, or pass --force.`
      : `${dest} — edited in place (matches no kit version). Move that fix into the kit, or pass --force to overwrite it.`)
    return
  }
  act(`${existsSync(dest) ? 'update' : 'copy'}: ${kitRel} → ${dest}`, () => {
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
    if (exec && process.platform !== 'win32') chmodSync(dest, 0o755)
  })
}

// ============ repo ============
if (!MACHINE_ONLY) {
if (resolve(REPO) === KIT) { console.error('gwork-install: --repo is the kit itself — point it at the repo to install into'); process.exit(1) }
if (git(REPO, 'rev-parse', '--git-dir') === null) { console.error(`gwork-install: ${REPO} is not a git repository`); process.exit(1) }
if (git(REPO, 'rev-parse', '--is-inside-work-tree')?.trim() !== 'true') { console.error(`gwork-install: ${REPO} has no working tree (a bare repository?) — install into a checkout`); process.exit(1) }
// core.hooksPath is resolved from the top of the working tree: hooks copied into a subdirectory would never run
const real = (p) => { try { return realpathSync(p) } catch { return p } }
const top = git(REPO, 'rev-parse', '--show-toplevel')?.trim()
if (top && real(top) !== real(REPO)) { console.error(`gwork-install: ${REPO} is inside the repository at ${top}, not its top — pass --repo "${top}"`); process.exit(1) }
const hooksPath = git(REPO, 'config', 'core.hooksPath')?.trim() ?? ''
if (hooksPath && !/(^|[\\/])githooks$/.test(hooksPath) && !FORCE) {
  console.error(`gwork-install: core.hooksPath is already "${hooksPath}". gwork needs it to be "githooks"; replacing it would switch off the hooks that are there. Move them into githooks/ first, or pass --force.`)
  process.exit(1)
}
for (const h of ['pre-push', 'commit-msg', 'pre-commit']) place('repo', `githooks/${h}`, join(REPO, 'githooks', h), { exec: true })
for (const s of ['tasklog-check.mjs', 'migrate.mjs']) place('repo', `scripts/${s}`, join(REPO, 'scripts', s))
if (hooksPath !== 'githooks') act('git config core.hooksPath githooks', () => git(REPO, 'config', 'core.hooksPath', 'githooks'))
if (!existsSync(join(REPO, 'task-log', 'INDEX.md'))) {
  const month = new Date().toISOString().slice(0, 7)
  act(`create task-log/INDEX.md and an empty task-log/${month}.md`, () => {
    mkdirSync(join(REPO, 'task-log'), { recursive: true })
    writeFileSync(join(REPO, 'task-log', 'INDEX.md'), '# task-log INDEX (dict — look up before touching a module, never read a whole shard)\n\n| Module | Entries (latest first) | BC | Gotcha (≤1 line) |\n|---|---|---|---|\n')
    if (!existsSync(join(REPO, 'task-log', `${month}.md`))) writeFileSync(join(REPO, 'task-log', `${month}.md`), '')
  })
  todo.push('An existing append-only log? Delete the empty task-log/ just created and run: node scripts/migrate.mjs "<log file>"')
}
// a repo that ignores scripts/ or githooks/ runs the kit locally and breaks for every clone (L-002)
const ignored = spawnSync('git', ['check-ignore', 'scripts/tasklog-check.mjs', 'githooks/pre-push', 'githooks/commit-msg', 'githooks/pre-commit', 'task-log/INDEX.md'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
for (const f of ignored) todo.push(`.gitignore hides ${f} — un-ignore it (ignore "/scripts/*" not "/scripts/", then "!/${f}")`)
if (has('ci')) {
  const wf = join(REPO, '.github', 'workflows', 'gwork-check.yml')
  if (existsSync(wf) && !same(join(KIT, 'templates', 'gwork-check.yml'), wf) && !FORCE) skipped.push(`${wf} — exists and differs from the template; pass --force to replace it.`)
  else if (!existsSync(wf) || FORCE) act(`copy: templates/gwork-check.yml → ${wf}`, () => { mkdirSync(dirname(wf), { recursive: true }); copyFileSync(join(KIT, 'templates', 'gwork-check.yml'), wf) })
  todo.push('Server-side check placed. It only holds once required: repository Settings → Branches → require the "gwork" status check.')
} else if (!existsSync(join(REPO, '.github', 'workflows', 'gwork-check.yml'))) {
  todo.push('No server-side check: `git push --no-verify` skips every local gate. Re-run with --ci to place a workflow that cannot be skipped.')
}
if (!existsSync(join(REPO, 'gwork.json'))) todo.push('No gwork.json: the default commit types, prepush checks and module map apply. Tune them per ADAPT.md (copy from gwork.example.json).')
todo.push('After `git add githooks`, `git ls-files -s githooks` must show 100755 (from Windows: git update-index --chmod=+x githooks/*).')
todo.push('CLAUDE.md: start from CLAUDE.template.md; move long gotchas into Known Bug Classes.')
todo.push('Review, then commit — the installer stages nothing.')
}

// ============ machine ============
if (MACHINE) {
  for (const h of ['tasklog-gotcha.mjs', 'model-profile.mjs']) place('machine', `hooks/${h}`, join(CLAUDE, 'hooks', h))
  for (const f of readdirSync(join(KIT, 'commands')).filter(f => f.endsWith('.md'))) place('machine', `commands/${f}`, join(CLAUDE, 'commands', f))
  for (const f of readdirSync(join(KIT, 'profiles')).filter(f => f.endsWith('.md'))) place('machine', `profiles/${f}`, join(CLAUDE, 'gwork-profiles', f))

  // settings.json: add what is missing, leave every other entry exactly as it is
  const settingsPath = join(CLAUDE, 'settings.json')
  let settings = {}
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')) }
    catch (e) { console.error(`gwork-install: ${settingsPath} is not valid JSON (${e.message}) — fix it first; nothing was registered`); process.exit(1) }
  }
  // the file is the user's: anything other than the documented shape is theirs to fix, not ours to guess at
  const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!plain(settings)) { console.error(`gwork-install: ${settingsPath} is not a JSON object — nothing was registered`); process.exit(1) }
  settings.hooks ??= {}
  if (!plain(settings.hooks) || Object.values(settings.hooks).some(v => !Array.isArray(v))) { console.error(`gwork-install: "hooks" in ${settingsPath} is not {event: [entries]} — fix it first; nothing was registered`); process.exit(1) }
  const fwd = (p) => p.replace(/\\/g, '/')
  let changed = false
  const register = (event, file, { matcher, timeout }) => {
    const list = (settings.hooks[event] ??= [])
    const mine = list.find(e => Array.isArray(e?.hooks) && e.hooks.some(h => typeof h?.command === 'string' && h.command.includes(file)))
    if (!mine) {
      list.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `node "${fwd(join(CLAUDE, 'hooks', file))}"`, timeout }] })
      changed = true; done.push(`settings.json: register ${file} on ${event}${matcher ? ` (${matcher})` : ''}`)
    } else if (matcher && mine.matcher !== matcher) {
      done.push(`settings.json: ${file} on ${event}: matcher "${mine.matcher ?? ''}" → "${matcher}"`)
      mine.matcher = matcher; changed = true
    }
  }
  register('PreToolUse', 'tasklog-gotcha.mjs', { matcher: 'Edit|Write|MultiEdit|Bash', timeout: 15 })
  register('SessionStart', 'tasklog-gotcha.mjs', { timeout: 10 })
  for (const ev of ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'PreToolUse', 'Stop']) register(ev, 'model-profile.mjs', { timeout: 10 })
  // PostModelSwitch exists from Claude Code 2.1.251; an unknown event name in settings.json is not
  // something to gamble on, so it is registered only when the installed version is known to have it
  const ver = (spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 8000 }).stdout ?? '').match(/(\d+)\.(\d+)\.(\d+)/)
  const hasPMS = ver && (+ver[1] > 2 || (+ver[1] === 2 && (+ver[2] > 1 || (+ver[2] === 1 && +ver[3] >= 251))))
  if (hasPMS) register('PostModelSwitch', 'model-profile.mjs', { timeout: 10 })
  else if (!(settings.hooks.PostModelSwitch ?? []).length) todo.push('PostModelSwitch not registered (needs Claude Code 2.1.251+, version not detected). Add it for model-profile.mjs once on a newer build.')
  if (changed && !DRY) {
    mkdirSync(CLAUDE, { recursive: true })
    if (existsSync(settingsPath)) copyFileSync(settingsPath, settingsPath + '.gwork-bak')
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    done.push(`settings.json written (previous version kept as settings.json.gwork-bak)`)
  }
} else {
  todo.push('Machine half not touched. Once per machine: re-run with --machine to install the hooks, commands, profiles and their settings.json entries.')
}
todo.push('Optional, when an agent runs this repo unattended: the sentinel (SKILL.md step 7). An agent may install it; only the owner attests.')

console.log(`gwork-install${DRY ? ' (dry run — nothing changed)' : ''} —${MACHINE_ONLY ? '' : ` repo ${REPO}`}${MACHINE ? `${MACHINE_ONLY ? '' : ' ·'} machine ${CLAUDE}` : ''}`)
console.log(done.length ? done.map(d => `  ${DRY ? 'would' : 'did'}: ${d}`).join('\n') : '  already up to date — nothing to do')
if (skipped.length) console.log('\nSkipped:\n' + skipped.map(s => `  ${s}`).join('\n'))
console.log('\nLeft for you:\n' + todo.map(t => `  - ${t}`).join('\n'))
if (!DRY) console.log(MACHINE_ONLY ? `\nVerify: node "${join(KIT, 'scripts', 'gwork-drift.mjs')}"` : `\nVerify: node scripts/tasklog-check.mjs · node "${join(KIT, 'scripts', 'gwork-drift.mjs')}" --repo "${REPO}"`)
process.exit(skipped.length ? 2 : 0)
