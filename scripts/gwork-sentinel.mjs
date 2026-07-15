#!/usr/bin/env node
/**
 * gwork-sentinel.mjs — tamper detector for the enforcement machinery itself.
 * The "filter stack" layer: enforcement state is snapshotted OUTSIDE the repo
 * (~/.gwork/sentinel/) and two independent channels verify it — git hooks at push
 * time and the agent-harness hooks (Claude PreToolUse / Hermes pre_tool_call) at
 * edit time. Disabling one channel is exactly what the other channel detects.
 *
 * What it can and cannot promise (by design, documented honestly):
 *   - Zero external setup: no second OS account, no hardware key, no remote.
 *   - An agent with the keyboard can still rewrite every layer INCLUDING this one —
 *     but only by leaving a journaled, hash-chained trail. The sentinel converts
 *     silent sabotage into recorded sabotage; it does not make sabotage impossible.
 *   - The bolted-down upgrade (owner commit signature) stays on the ROADMAP.
 *
 * Protected state (per repo):
 *   machinery — sha256 of githooks/pre-push, githooks/commit-msg,
 *               scripts/tasklog-check.mjs, scripts/gwork-sentinel.mjs,
 *               plus the value of `git config core.hooksPath`
 *   guards    — sha256 of gwork.json's {forbidden, prepush} sections
 *
 * Commands (run from the repo root, or pass --repo <path>):
 *   init | update   snapshot current state (asks y/N on a TTY; headless needs
 *                   GWORK_SENTINEL_CONFIRM=<stateHash> — journaled as non-interactive)
 *   verify [--json] exit 0 ok / no snapshot · 2 machinery tampered · 3 guards changed
 *   hash            print the current stateHash (what CONFIRM must equal)
 *   install         copy this script to <home>/bin/ and run init
 *   journal         print the audit journal
 *
 * State home: ~/.gwork (override: GWORK_HOME — meaningful for tests/sandboxes; an
 * agent-side override of GWORK_HOME only blinds the channels the agent already owns,
 * the harness-spawned hook channel keeps its own environment).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const cmd = args.find(a => !a.startsWith('--')) ?? 'verify'
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : undefined }
const has = (name) => args.includes(`--${name}`)

const REPO = resolve(opt('repo') ?? process.cwd())
const HOME = process.env.GWORK_HOME ?? join(homedir(), '.gwork')
const sha = (s) => createHash('sha256').update(s).digest('hex')
const repoKey = sha(REPO.replace(/\\/g, '/').toLowerCase()).slice(0, 16)
const SNAP = join(HOME, 'sentinel', `${repoKey}.json`)
const JOURNAL = join(HOME, 'sentinel', `${repoKey}.journal`)

const MACHINERY_FILES = ['githooks/pre-push', 'githooks/commit-msg', 'scripts/tasklog-check.mjs', 'scripts/gwork-sentinel.mjs']

function currentState() {
  const files = {}
  for (const f of MACHINERY_FILES) {
    const p = join(REPO, f)
    // normalize CRLF so a line-ending-only touch (git autocrlf) is not a tamper alarm
    files[f] = existsSync(p) ? sha(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')) : 'MISSING'
  }
  let hooksPath = 'MISSING'
  try { hooksPath = execSync('git config core.hooksPath', { cwd: REPO, encoding: 'utf8' }).trim() || 'MISSING' } catch { /* unset */ }
  let cfg = {}
  try { cfg = JSON.parse(readFileSync(join(REPO, 'gwork.json'), 'utf8')) } catch { /* absent/broken = defaults; guards hash reflects that */ }
  const guards = sha(JSON.stringify({ forbidden: cfg.forbidden ?? [], prepush: cfg.prepush ?? null }))
  return { files, hooksPath, guards }
}
const stateHash = (st) => sha(JSON.stringify(st))

function diffState(old, cur) {
  const machinery = [], guardsChanged = []
  for (const f of MACHINERY_FILES) if (old.files[f] !== cur.files[f]) machinery.push(`${f}: ${old.files[f] === 'MISSING' ? 'appeared' : cur.files[f] === 'MISSING' ? 'DELETED' : 'content changed'}`)
  if (old.hooksPath !== cur.hooksPath) machinery.push(`core.hooksPath: "${old.hooksPath}" → "${cur.hooksPath}"`)
  if (old.guards !== cur.guards) guardsChanged.push('gwork.json {forbidden, prepush} changed vs snapshot')
  return { machinery, guardsChanged }
}

function journalAppend(entry) {
  mkdirSync(join(HOME, 'sentinel'), { recursive: true })
  let prev = 'genesis'
  if (existsSync(JOURNAL)) {
    const lines = readFileSync(JOURNAL, 'utf8').trim().split('\n').filter(Boolean)
    if (lines.length) prev = sha(lines[lines.length - 1])
  }
  appendFileSync(JOURNAL, JSON.stringify({ ...entry, prev }) + '\n')
}

async function confirmUpdate(cur, oldSnap) {
  const h = stateHash(cur)
  if (process.env.GWORK_SENTINEL_CONFIRM === h) return { ok: true, interactive: false }
  if (!process.stdin.isTTY) {
    console.error(`sentinel: refusing non-interactive ${oldSnap ? 'update' : 'init'} — a human must confirm on a terminal.`)
    console.error(`  Headless override (journaled as non-interactive): GWORK_SENTINEL_CONFIRM=${h}`)
    return { ok: false }
  }
  if (oldSnap) {
    const d = diffState(oldSnap, cur)
    for (const m of [...d.machinery, ...d.guardsChanged]) console.log(`  changed: ${m}`)
    if (!d.machinery.length && !d.guardsChanged.length) console.log('  (no changes vs existing snapshot)')
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(r => rl.question(`sentinel: snapshot enforcement state of ${REPO}? [y/N] `, r))
  rl.close()
  return { ok: /^y(es)?$/i.test(answer.trim()), interactive: true }
}

if (cmd === 'hash') {
  console.log(stateHash(currentState()))
} else if (cmd === 'init' || cmd === 'update') {
  const cur = currentState()
  const oldSnap = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, 'utf8')) : null
  const { ok, interactive } = await confirmUpdate(cur, oldSnap?.state)
  if (!ok) process.exit(1)
  mkdirSync(join(HOME, 'sentinel'), { recursive: true })
  writeFileSync(SNAP, JSON.stringify({ repo: REPO, state: cur, hash: stateHash(cur), at: new Date().toISOString() }, null, 2))
  journalAppend({ at: new Date().toISOString(), action: oldSnap ? 'update' : 'init', hash: stateHash(cur), interactive })
  console.log(`sentinel: snapshot ${oldSnap ? 'updated' : 'created'} (${stateHash(cur).slice(0, 12)}…)${interactive ? '' : ' [non-interactive]'}`)
} else if (cmd === 'install') {
  mkdirSync(join(HOME, 'bin'), { recursive: true })
  copyFileSync(join(REPO, 'scripts/gwork-sentinel.mjs'), join(HOME, 'bin', 'gwork-sentinel.mjs'))
  console.log(`sentinel: installed to ${join(HOME, 'bin', 'gwork-sentinel.mjs')} — now run: node "${join(HOME, 'bin', 'gwork-sentinel.mjs')}" init --repo "${REPO}"`)
} else if (cmd === 'journal') {
  console.log(existsSync(JOURNAL) ? readFileSync(JOURNAL, 'utf8').trim() : '(empty)')
} else if (cmd === 'verify') {
  if (!existsSync(SNAP)) { if (!has('json')) console.log('sentinel: no snapshot for this repo — not installed, nothing to verify'); else console.log('{"installed":false}'); process.exit(0) }
  const old = JSON.parse(readFileSync(SNAP, 'utf8')).state
  const d = diffState(old, currentState())
  const code = d.machinery.length ? 2 : d.guardsChanged.length ? 3 : 0
  if (has('json')) {
    console.log(JSON.stringify({ installed: true, ok: code === 0, machinery: d.machinery, guards: d.guardsChanged }))
  } else if (code === 0) {
    console.log('sentinel OK — enforcement machinery matches the owner snapshot')
  } else {
    console.error(`sentinel TAMPER${code === 2 ? ' (machinery)' : ' (guards)'}:`)
    for (const m of [...d.machinery, ...d.guardsChanged]) console.error('  ' + m)
    console.error('  If the owner made this change: node scripts/gwork-sentinel.mjs update (interactive)')
  }
  process.exit(code)
} else {
  console.error(`sentinel: unknown command "${cmd}" — use init|update|verify|hash|install|journal`)
  process.exit(1)
}
