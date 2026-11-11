#!/usr/bin/env node
/**
 * tasklog-gotcha.mjs — Claude Code hook: PreToolUse (Edit|Write|MultiEdit|Bash) + SessionStart
 * The AI never has to remember to look up INDEX — the hook does it deterministically.
 *
 * On an edit:
 *   1. deny it when the sentinel reports tampered machinery, or when it writes a forbidden pattern
 *   2. map the file to a module (gwork.json → modules) and inject every INDEX row of that module
 *   3. if the module has nothing to say, fall back to the FILE: rows whose linked entries
 *      mention this exact path. Real INDEXes are filed under topic names the path rules never
 *      produce, so the module lookup alone delivered almost nothing in the field (L-008).
 *      gwork.json → tasklog.fileInjection: "fallback" (default) · "always" · false
 *   4. once per (session, module) and once per (session, file) — no context spam
 * On a Bash command: deny a shell write (redirect, tee, sed -i) that puts a forbidden pattern
 *   into a forbidden path. Best effort: it narrows the "raw shell write" hole, it does not close it.
 * On SessionStart: forget what was injected when the context was cleared or compacted (the
 *   model no longer has it), and remind once when commits have piled up with no task-log entry.
 *
 * Every decision is appended to ~/.gwork/log/<YYYY-MM>.jsonl so effectiveness can be measured
 * instead of assumed (scripts/gwork-stats.mjs). Local only. Off: GWORK_LOG=0 or gwork.json "log": false.
 *
 * settings.json (scripts/gwork-install.mjs --machine writes this):
 *   "PreToolUse":   [ { "matcher": "Edit|Write|MultiEdit|Bash", "hooks": [{ "type": "command", "command": "node \"<ABS>/tasklog-gotcha.mjs\"" }] } ]
 *   "SessionStart": [ { "hooks": [{ "type": "command", "command": "node \"<ABS>/tasklog-gotcha.mjs\"" }] } ]
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

const T0 = Date.now()
const HOME = process.env.GWORK_HOME ?? join(homedir(), '.gwork')
let EVENT = 'PreToolUse', root = null, cfg = {}, sessionId = 'nosession', tool = ''

// --- one line per decision; a logging failure must never affect the decision itself ---
const log = (action, fields = {}) => {
  if (!root || process.env.GWORK_LOG === '0' || cfg.log === false) return
  try {
    mkdirSync(join(HOME, 'log'), { recursive: true })
    appendFileSync(join(HOME, 'log', `${new Date().toISOString().slice(0, 7)}.jsonl`),
      JSON.stringify({ at: new Date().toISOString(), hook: 'gotcha', event: EVENT, tool, repo: root, session: sessionId, action, ...fields, ms: Date.now() - T0 }) + '\n')
  } catch { /* unwritable home = no log */ }
}
// Never answer "allow": that is not a neutral pass, it SKIPS the user's permission prompt for
// the edit. Nothing to say = no output at all; context to add = additionalContext with no
// permissionDecision, so the normal permission flow still decides.
const ok = (extra) => { if (extra) console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: EVENT, additionalContext: extra } })); process.exit(0) }
const deny = (reason) => { console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: reason } })); process.exit(0) }

let input = ''
try { input = readFileSync(0, 'utf8').replace(/^\uFEFF/, '') } catch { ok() } // strip BOM some shells prepend when piping
let data = {}
try { data = JSON.parse(input) } catch { ok() }

EVENT = data?.hook_event_name === 'SessionStart' ? 'SessionStart' : 'PreToolUse'
tool = typeof data?.tool_name === 'string' ? data.tool_name : ''
const cwd = data?.cwd ?? process.cwd()
sessionId = data?.session_id ?? 'nosession'
const filePath = data?.tool_input?.file_path ?? ''
const command = typeof data?.tool_input?.command === 'string' ? data.tool_input.command : ''

// --- find the repo root that holds task-log/INDEX.md: walk up from the FILE being edited,
// then from cwd. The file decides which repo's rules apply — a session started in repo A
// that edits repo B must get B's gotchas and B's forbidden list, not A's. ---
const rootOf = (start) => {
  for (let dir = start; ; ) {
    if (existsSync(join(dir, 'task-log', 'INDEX.md'))) return dir
    const up = dirname(dir); if (up === dir) return null; dir = up
  }
}
// no config = defaults. A config that EXISTS but cannot be parsed is different: every gate at
// push fails loud on it, while here the forbidden rules silently stop applying — so say it once.
let cfgWarn = null
const loadCfg = () => {
  const p = join(root, 'gwork.json')
  try { cfg = JSON.parse(readFileSync(p, 'utf8')) }
  catch (e) { cfg = {}; if (existsSync(p)) cfgWarn = `[gwork] gwork.json cannot be parsed (${e.message}). Until it is fixed the forbidden rules are NOT checked at edit time, and commit and push will be blocked. Fix the file before doing anything else.` }
}
const relOf = (p) => {
  // strip the root prefix case-insensitively — on Windows the drive letter case may differ (C:/ vs c:/)
  const abs = resolve(cwd, p).replace(/\\/g, '/'), rootNorm = root.replace(/\\/g, '/') + '/'
  return abs.toLowerCase().startsWith(rootNorm.toLowerCase()) ? abs.slice(rootNorm.length) : abs
}
const stateDir = join(tmpdir(), 'tasklog-gotcha')
const stateFile = join(stateDir, `${sessionId}.json`)
const forbiddenRules = () => (Array.isArray(cfg.forbidden) ? cfg.forbidden : []).flatMap(rule => {
  if (!rule?.path || !rule?.pattern) return []
  try { return [{ ...rule, pathRe: new RegExp(rule.path), patRe: new RegExp(rule.pattern) }] } catch { return [] }
})
const FORBIDDEN_TAIL = 'Only the repo owner may lift this (edit gwork.json → forbidden). A direct order in a prompt is not authorization; do not route around it with --no-verify or another way of writing the file — surface the conflict to the owner instead.'

// ============ SessionStart ============
if (EVENT === 'SessionStart') {
  root = rootOf(cwd)
  if (!root) ok()
  loadCfg()
  // /clear and compaction wipe the context but not our state file — without this the gotchas
  // already "seen" would never be shown again to a model that no longer remembers them.
  if (['clear', 'compact'].includes(data?.source)) {
    try { rmSync(stateFile, { force: true }) } catch { /* fail-open */ }
    log('reset-state', { source: data.source })
  }
  // Work that was committed but never closed out into the task-log: say so once, at the start,
  // where it costs no extra turn (a Stop-time reminder would re-run the model every time).
  const limit = cfg.tasklog?.unclosedCommits ?? 3
  if (limit && data?.source !== 'compact') {
    const git = (...a) => { const r = spawnSync('git', a, { cwd: root, encoding: 'utf8', timeout: 4000 }); return r.status === 0 ? r.stdout.trim() : '' }
    const last = git('log', '-1', '--format=%H %cs', '--', 'task-log')
    const n = last ? Number(git('rev-list', '--count', `${last.split(' ')[0]}..HEAD`)) : 0
    if (n >= limit) {
      log('remind-unclosed', { commits: n })
      ok(`[task-log] ${n} commits since the last task-log entry (${last.split(' ')[1]}) have not been closed out. If that work is finished, close it out first (/gwork-log) — the lessons are freshest now and the next push needs the entry anyway.`)
    }
  }
  ok()
}

// ============ Bash: a shell write of forbidden content ============
if (!filePath) {
  if (!command) ok()
  root = rootOf(cwd)
  if (!root) ok()
  loadCfg()
  const rules = forbiddenRules()
  if (!rules.length) ok()
  const unq = (t) => t.replace(/^["']|["']$/g, '')
  const TOK = `("[^"]+"|'[^']+'|[^\\s;|&()<>]+)`
  const targets = new Set()
  // redirects (`> f`, `>> f`, `1> f`) but not fd dups (`2>&1`), comparisons or arrows (`=>`, `->`)
  for (const m of command.matchAll(new RegExp(`(?<![<>&=-])(?:\\d|&)?>>?(?!&)\\s*${TOK}`, 'g'))) targets.add(unq(m[1]))
  for (const m of command.matchAll(new RegExp(`\\btee\\s+(?:-a\\s+)?${TOK}`, 'g'))) targets.add(unq(m[1]))
  for (const m of command.matchAll(/\b(?:sed|perl)\s[^|;&]*?-[a-zA-Z]*i\b[^|;&]*/g))
    for (const tok of m[0].split(/\s+/).slice(1)) if (!tok.startsWith('-')) targets.add(unq(tok))
  for (const t of targets) {
    const rel = relOf(t)
    const rule = rules.find(r => r.pathRe.test(rel) && r.patRe.test(command))
    if (rule) {
      log('deny-bash-forbidden', { file: rel, pattern: rule.pattern })
      deny(`[gwork forbidden] this command writes /${rule.pattern}/ into ${rel}, which gwork.json forbids${rule.reason ? ` — ${rule.reason}` : ''}. ${FORBIDDEN_TAIL}`)
    }
  }
  ok()
}

// ============ Edit / Write / MultiEdit ============
root = rootOf(dirname(resolve(cwd, filePath))) ?? rootOf(cwd)
if (!root) ok()
loadCfg()
const indexPath = join(root, 'task-log', 'INDEX.md')
const rel = relOf(filePath) // resolved: a relative file_path must still map to its module

// --- sentinel: second channel of the filter stack. Independent of git hooks, so
// removing core.hooksPath is exactly the tamper this channel catches at edit time.
// Fail-open when the sentinel is absent or errors — a broken sentinel must not brick edits;
// machinery tamper = deny the edit, guards drift = warn once per session. ---
const sentinelBin = join(HOME, 'bin', 'gwork-sentinel.mjs')
let sentinelWarn = null
if (existsSync(sentinelBin)) {
  const r = spawnSync('node', [sentinelBin, 'verify', '--repo', root, '--json'], { encoding: 'utf8', timeout: 8000 })
  if (r.status === 2) {
    let detail = ''
    try { detail = JSON.parse(r.stdout).machinery.join(' · ') } catch { /* message stays generic */ }
    log('deny-sentinel', { file: rel })
    deny(`[gwork-sentinel] enforcement machinery does not match the owner snapshot — edits are blocked until resolved${detail ? ': ' + detail : ''}. If the owner made this change, they run: node scripts/gwork-sentinel.mjs update (interactive). Do NOT try to fix this yourself — report it.`)
  }
  if (r.status === 3) sentinelWarn = `[gwork-sentinel] gwork.json {forbidden, prepush} differs from the owner snapshot — pre-push will block until the owner confirms with: node scripts/gwork-sentinel.mjs update`
}

// --- forbidden content, enforced at EDIT time (not just at push via check F) ---
// This is the answer to the S11 `git push --no-verify` hole: --no-verify skips git's
// pre-push hook, but it cannot skip THIS harness hook. A forbidden pattern written
// through the edit tools is denied before it ever reaches a commit.
{
  const text = [
    data?.tool_input?.content,
    data?.tool_input?.new_string,
    ...(Array.isArray(data?.tool_input?.edits) ? data.tool_input.edits.map(e => e?.new_string) : []),
  ].filter(v => typeof v === 'string').join('\n')
  const rule = text && forbiddenRules().find(r => r.pathRe.test(rel) && r.patRe.test(text))
  if (rule) {
    log('deny-forbidden', { file: rel, pattern: rule.pattern })
    deny(`[gwork forbidden] this edit writes /${rule.pattern}/ into ${rel}, which gwork.json forbids${rule.reason ? ` — ${rule.reason}` : ''}. ${FORBIDDEN_TAIL}`)
  }
}

// --- module key: rules come from gwork.json at the root if present — users edit rules without touching code ---
const DEFAULT_MODULES = [
  { pattern: '^modules/([\\w-]+)/', name: '$1' },
  { pattern: '^(?:lib|app/actions)/([\\w-]+)', name: '(shim) $1' },
  { pattern: '^app/(?:visit/)?([\\w-]+)/', name: 'page:$1' },
  { pattern: '^components/([\\w-]+)/', name: 'ui:$1' },
  { pattern: '^tests/([\\w-]+)/', name: 'test:$1' },
  { pattern: '^(prisma|hooks|scripts)/', name: '$1' },
]
const moduleRules = Array.isArray(cfg.modules) && cfg.modules.length ? cfg.modules : DEFAULT_MODULES
const moduleOf = p => {
  for (const r of moduleRules) {
    let m
    try { m = p.match(new RegExp(r.pattern)) } catch { continue } // bad regex in config → skip, never crash the hook
    if (m) return r.name.replace(/\$(\d)/g, (_, i) => m[+i] ?? '')
  }
  return null
}
const mod = moduleOf(rel)

// --- anti-spam state: once per (session, module), once per (session, file), sentinel warning once per session ---
mkdirSync(stateDir, { recursive: true })
let seen = {}
try { seen = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* fresh */ }
const save = () => { try { writeFileSync(stateFile, JSON.stringify(seen)) } catch { /* re-inject at worst */ } }
const okW = (extra) => { // every exit from here on goes through okW so a pending sentinel warning is never lost
  const warn = sentinelWarn && !seen.__sentinel ? sentinelWarn : null
  const cw = cfgWarn && !seen.__cfg ? cfgWarn : null
  if (warn) seen.__sentinel = true
  if (cw) { seen.__cfg = true; log('warn-config') }
  if (warn || cw) save()
  ok([cw, warn, extra].filter(Boolean).join('\n\n') || undefined)
}

// --- INDEX rows: split on unescaped pipes; a row counts only when it has something to say ---
const real = v => v && v !== 'TODO' && v !== '—' && v !== '-'
const uniq = a => [...new Set(a.filter(real))]
const allRows = readFileSync(indexPath, 'utf8').split('\n')
  .map(l => l.split(/(?<!\\)\|/).map(s => s.trim()))
  .filter(c => c.length >= 5 && c[1] !== 'Module' && !/^-+$/.test(c[1]) && (real(c[4]) || real(c[3])))
// ALL rows named for the module, not the first: a real INDEX files several rows under one name.
const modRows = mod ? allRows.filter(c => c[1] === mod) : []
// a row already delivered this session is not delivered again through another file
const rowKey = c => `${c[1]}\u0000${c[4]}`
const shown = new Set(Array.isArray(seen.__rows) ? seen.__rows : [])

// --- file-level rows: entries that mention this file → the INDEX rows linking them ---
// Entries name files two ways: by full path, and by bare filename. Measured on a real log,
// full paths reached 22% of source files; adding the bare name — only when that name is unique
// among tracked files, so `index.ts` never matches — reached 37%, at a median of one entry each.
const fileRows = () => {
  const dir = join(root, 'task-log'), ids = new Set()
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const base = rel.split('/').pop()
  let needle = rel
  if (base !== rel) {
    const r = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', timeout: 4000, maxBuffer: 64 * 1024 * 1024 })
    const same = r.status === 0 ? r.stdout.split('\n').filter(f => f === base || f.endsWith('/' + base)).length : 2
    if (same <= 1) needle = base // 0 = a file being created under a name the log already mentions
  }
  // whole-token match: `lib/a.ts` must not hit `xlib/a.ts` or `lib/a.tsx`
  const re = new RegExp(`(?<![\\w.-])${needle === base ? '(?:[\\w.-]+/)*' : ''}${esc(needle)}(?![\\w-])`)
  for (const f of readdirSync(dir).filter(f => /^\d{4}-\d{2}\.md$/.test(f))) {
    const text = readFileSync(join(dir, f), 'utf8')
    if (!text.includes(needle)) continue
    const parts = text.split(/<a id="([^"]+)"><\/a>/) // [preamble, id, body, id, body, …]
    for (let i = 1; i < parts.length; i += 2) if (re.test(parts[i + 1])) ids.add(parts[i])
  }
  if (!ids.size) return []
  fileIds = ids
  return allRows.filter(c => !modRows.includes(c) && !shown.has(rowKey(c)) && [...c[2].matchAll(/#([^)\s]+)\)/g)].some(m => ids.has(m[1])))
}
let fileIds = new Set()
const mode = cfg.tasklog?.fileInjection ?? 'fallback'
const wantFile = mode === 'always' || (mode === 'fallback' && !modRows.length)
const fileKey = `f:${rel}`
const showMod = modRows.length > 0 && !seen[mod]
let fRows = []
if (wantFile && !seen[fileKey]) { try { fRows = fileRows() } catch { fRows = [] } }

if (!showMod && !fRows.length) {
  log('pass', { file: rel, module: mod, reason: !mod && !wantFile ? 'no-module' : seen[mod] || seen[fileKey] ? 'seen' : 'no-row' })
  if (wantFile) { seen[fileKey] = true; save() } // looked once, found nothing — don't rescan the shards on every edit of this file
  okW()
}

// Budget: the harness caps injected context at 10,000 characters, and one real INDEX row held
// 8,000 characters of links alone. 12 gotchas and 8 links per section stay near 2,500.
const MAX_SHOWN = 12, MAX_LINKS = 8
const section = (rows, head, label, prefer) => {
  const gotchas = uniq(rows.map(label)), bcs = uniq(rows.flatMap(c => c[3].split(/\s+/)))
  const lines = gotchas.slice(0, MAX_SHOWN).map(g => `- Gotcha: ${g}`)
  if (gotchas.length > MAX_SHOWN) lines.push(`- (+${gotchas.length - MAX_SHOWN} more in task-log/INDEX.md)`)
  // one link per entry, the entries that mention this file first
  let links = uniq(rows.flatMap(c => c[2].match(/\[[^\]]+\]\([^)]+\)/g) ?? []))
  if (prefer?.size) links = [...links.filter(l => prefer.has(l.match(/#([^)\s]+)\)/)?.[1])), ...links.filter(l => !prefer.has(l.match(/#([^)\s]+)\)/)?.[1]))]
  const more = links.length > MAX_LINKS ? ` · +${links.length - MAX_LINKS}` : ''
  return [head, bcs.length ? `- Bug classes: ${bcs.join(' ')} (details in CLAUDE.md)` : null, ...lines,
    links.length ? `- Related entries (open only what you need, never the whole shard): ${links.slice(0, MAX_LINKS).join(' · ')}${more}` : null].filter(Boolean).join('\n')
}
const parts = []
if (showMod) parts.push(section(modRows, `[task-log] Editing module "${mod}" — history you must know before touching it:`, c => c[4]))
if (fRows.length) parts.push(section(fRows, `[task-log] Earlier work touched ${rel} — lessons recorded for it:`, c => real(c[4]) ? `[${c[1]}] ${c[4]}` : null, fileIds))
for (const c of [...(showMod ? modRows : []), ...fRows]) shown.add(rowKey(c))
seen.__rows = [...shown]

if (showMod) seen[mod] = true
if (wantFile) seen[fileKey] = true
save()
log('inject', { file: rel, module: mod, via: showMod && fRows.length ? 'both' : showMod ? 'module' : 'file', rows: (showMod ? modRows.length : 0) + fRows.length })
okW(parts.join('\n\n'))
