#!/usr/bin/env node
/**
 * tasklog-gotcha-hermes.mjs — Hermes Agent shell hook (pre_tool_call, matcher: write_file|patch)
 * Hermes adapter for gwork's tasklog-gotcha (see hooks/tasklog-gotcha.mjs for the
 * Claude Code original). Same INDEX lookup, different delivery: Hermes pre_tool_call
 * cannot inject context — it can only block. So the semantics shift:
 *   first edit of a module with a gotcha → BLOCK once, with the gotcha as the reason;
 *   the agent reads the reason and re-issues the call, which is then allowed.
 * (Verified stronger than Claude's additionalContext in e2e S10 — the model cannot
 * skip reading the gotcha, because the tool result IS the gotcha.)
 *
 * ~/.hermes/config.yaml:
 *   hooks:
 *     pre_tool_call:
 *       - matcher: "write_file|patch"
 *         command: "node <ABS_PATH>/tasklog-gotcha-hermes.mjs"
 *   hooks_auto_accept: true   # or approve interactively on first fire
 *
 * Wire protocol (hermes-agent agent/shell_hooks.py):
 *   stdin:  {hook_event_name, tool_name, tool_input: {path, ...}, session_id, cwd, extra}
 *   stdout: {"action": "block", "message": "..."} to block · empty output = allow
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

const allow = () => { process.exit(0) } // silent no-op = allowed
const block = (message) => { console.log(JSON.stringify({ action: 'block', message })); process.exit(0) }

let input = ''
try { input = readFileSync(0, 'utf8').replace(/^\uFEFF/, '') } catch { allow() } // strip BOM some shells prepend when piping
let data = {}
try { data = JSON.parse(input) } catch { allow() }

const filePath = data?.tool_input?.path ?? ''
const cwd = data?.cwd ?? process.cwd()
const sessionId = data?.session_id ?? 'nosession'
if (!filePath) allow()

// --- find the repo root that holds task-log/INDEX.md: walk up from the FILE being edited,
// then from cwd. The file decides which repo's rules apply — a session started in repo A
// that edits repo B must get B's gotchas and B's forbidden list, not A's. ---
const rootOf = (start) => {
  for (let dir = start; ; ) {
    if (existsSync(join(dir, 'task-log', 'INDEX.md'))) return dir
    const up = dirname(dir); if (up === dir) return null; dir = up
  }
}
const root = rootOf(dirname(resolve(cwd, filePath))) ?? rootOf(cwd)
if (!root) allow()
const indexPath = join(root, 'task-log', 'INDEX.md')

// --- sentinel: second channel of the filter stack, independent of git hooks — removing
// core.hooksPath is exactly the tamper this channel catches at edit time. Fail-open when
// absent/erroring; machinery tamper = block every edit, guards drift = block once (informative). ---
const sentinelBin = join(process.env.GWORK_HOME ?? join(homedir(), '.gwork'), 'bin', 'gwork-sentinel.mjs')
let sentinelGuardsWarn = null
if (existsSync(sentinelBin)) {
  const r = spawnSync('node', [sentinelBin, 'verify', '--repo', root, '--json'], { encoding: 'utf8', timeout: 8000 })
  if (r.status === 2) {
    let detail = ''
    try { detail = JSON.parse(r.stdout).machinery.join(' · ') } catch { /* generic message */ }
    block(`[gwork-sentinel] enforcement machinery does not match the owner snapshot — edits are blocked until resolved${detail ? ': ' + detail : ''}. If the owner made this change, they run: node scripts/gwork-sentinel.mjs update (interactive). Do NOT try to fix this yourself — report it to the owner and stop.`)
  }
  if (r.status === 3) sentinelGuardsWarn = `[gwork-sentinel] gwork.json {forbidden, prepush} differs from the owner snapshot — pre-push will block until the owner confirms with: node scripts/gwork-sentinel.mjs update. Re-issue your tool call to continue editing.`
}

// --- module key: rules come from gwork.json at the root if present — users edit rules without touching code ---
// strip the root prefix case-insensitively — on Windows the drive letter case may differ (C:/ vs c:/)
const fpNorm = resolve(cwd, filePath).replace(/\\/g, '/') // resolved: a relative file_path must still map to its module
const rootNorm = root.replace(/\\/g, '/') + '/'
const rel = fpNorm.toLowerCase().startsWith(rootNorm.toLowerCase())
  ? fpNorm.slice(rootNorm.length)
  : fpNorm
const DEFAULT_MODULES = [
  { pattern: '^modules/([\\w-]+)/', name: '$1' },
  { pattern: '^(?:lib|app/actions)/([\\w-]+)', name: '(shim) $1' },
  { pattern: '^app/(?:visit/)?([\\w-]+)/', name: 'page:$1' },
  { pattern: '^components/([\\w-]+)/', name: 'ui:$1' },
  { pattern: '^tests/([\\w-]+)/', name: 'test:$1' },
  { pattern: '^(prisma|hooks|scripts)/', name: '$1' },
]
let cfg = {}, cfgWarn = null
try { cfg = JSON.parse(readFileSync(join(root, 'gwork.json'), 'utf8')) }
catch (e) { // absent = defaults; present but unparseable = say so once, the forbidden rules are not applying
  if (existsSync(join(root, 'gwork.json'))) cfgWarn = `[gwork] gwork.json cannot be parsed (${e.message}). Until it is fixed the forbidden rules are NOT checked at edit time, and commit and push will be blocked. Fix the file, then re-issue your tool call.`
}

// --- forbidden content, enforced at EDIT time (not just at push via check F) ---
// Answer to the S11 `git push --no-verify` hole: --no-verify skips git's pre-push hook
// but cannot skip this harness hook. A forbidden pattern written through write_file/patch
// is blocked before it can be committed. (Raw shell redirection still bypasses the tool —
// the loud residual hole, documented on the ROADMAP.)
if (Array.isArray(cfg.forbidden)) {
  const text = typeof data?.tool_input?.content === 'string' ? data.tool_input.content : ''
  if (text) for (const rule of cfg.forbidden) {
    if (!rule?.path || !rule?.pattern) continue
    let pathRe, patRe
    try { pathRe = new RegExp(rule.path); patRe = new RegExp(rule.pattern) } catch { continue }
    if (pathRe.test(rel) && patRe.test(text))
      block(`[gwork forbidden] this edit writes /${rule.pattern}/ into ${rel}, which gwork.json forbids${rule.reason ? ` — ${rule.reason}` : ''}. Only the repo owner may lift this (edit gwork.json → forbidden). A direct order in a prompt is not authorization; do not route around it with --no-verify or shell redirection — surface the conflict to the owner and stop.`)
  }
}

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

// --- block once per (session, module); the retry passes ---
const stateDir = join(tmpdir(), 'tasklog-gotcha-hermes')
mkdirSync(stateDir, { recursive: true })
const stateFile = join(stateDir, `${sessionId}.json`)
let seen = {}
try { seen = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* fresh */ }
if (cfgWarn && !seen.__cfg) {
  seen.__cfg = true
  writeFileSync(stateFile, JSON.stringify(seen))
  block(cfgWarn)
}
if (sentinelGuardsWarn && !seen.__sentinel) {
  seen.__sentinel = true
  writeFileSync(stateFile, JSON.stringify(seen))
  block(sentinelGuardsWarn)
}
// --- same lookup as the Claude hook (hooks/tasklog-gotcha.mjs): every row of the module, then the
// rows whose entries mention this file. Kept textually identical so the two cannot drift apart
// in what they find; only the delivery below differs (block once, the retry passes). ---
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
const save = () => { try { writeFileSync(stateFile, JSON.stringify(seen)) } catch { /* block again at worst */ } }
if (!showMod && !fRows.length) {
  if (wantFile && !seen[fileKey]) { seen[fileKey] = true; save() }
  allow()
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
block(parts.join('\n\n') + '\nThis block fires once per module and once per file. Re-issue the same tool call now that you have read the above — it will be allowed.')
