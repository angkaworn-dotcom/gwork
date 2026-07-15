#!/usr/bin/env node
/**
 * tasklog-gotcha.mjs — PreToolUse hook (Edit|Write|MultiEdit)
 * The AI never has to remember to look up INDEX — the hook does it deterministically:
 *   1. read the file_path about to be edited → map to a module key (same rules as migrate.mjs)
 *   2. open task-log/INDEX.md and find that module's row
 *   3. if it has a gotcha/BC → inject into context via additionalContext
 *   4. remember per (session, module) — warn once per module, no context spam
 *
 * settings.json:
 *   "hooks": { "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit",
 *     "hooks": [{ "type": "command", "command": "node \"<ABS_PATH>/tasklog-gotcha.mjs\"" }] } ] }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

const ok = (extra) => { console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
    ...(extra ? { additionalContext: extra } : {}) } })); process.exit(0) }
const deny = (reason) => { console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: reason } })); process.exit(0) }

let input = ''
try { input = readFileSync(0, 'utf8').replace(/^\uFEFF/, '') } catch { ok() } // strip BOM some shells prepend when piping
let data = {}
try { data = JSON.parse(input) } catch { ok() }

const filePath = data?.tool_input?.file_path ?? ''
const cwd = data?.cwd ?? process.cwd()
const sessionId = data?.session_id ?? 'nosession'
if (!filePath) ok()

// --- find the repo root that holds task-log/INDEX.md (walk up from cwd) ---
let root = cwd, indexPath = ''
for (let i = 0; i < 6; i++) {
  const p = join(root, 'task-log', 'INDEX.md')
  if (existsSync(p)) { indexPath = p; break }
  const up = dirname(root); if (up === root) break; root = up
}
if (!indexPath) ok()

// --- sentinel: second channel of the filter stack. Independent of git hooks, so
// removing core.hooksPath is exactly the tamper this channel catches at edit time.
// Fail-open when the sentinel is absent or errors — a broken sentinel must not brick edits;
// machinery tamper = deny the edit, guards drift = warn once per session. ---
const sentinelBin = join(process.env.GWORK_HOME ?? join(homedir(), '.gwork'), 'bin', 'gwork-sentinel.mjs')
let sentinelWarn = null
if (existsSync(sentinelBin)) {
  const r = spawnSync('node', [sentinelBin, 'verify', '--repo', root, '--json'], { encoding: 'utf8', timeout: 8000 })
  if (r.status === 2) {
    let detail = ''
    try { detail = JSON.parse(r.stdout).machinery.join(' · ') } catch { /* message stays generic */ }
    deny(`[gwork-sentinel] enforcement machinery does not match the owner snapshot — edits are blocked until resolved${detail ? ': ' + detail : ''}. If the owner made this change, they run: node scripts/gwork-sentinel.mjs update (interactive). Do NOT try to fix this yourself — report it.`)
  }
  if (r.status === 3) sentinelWarn = `[gwork-sentinel] gwork.json {forbidden, prepush} differs from the owner snapshot — pre-push will block until the owner confirms with: node scripts/gwork-sentinel.mjs update`
}

// --- module key: rules come from gwork.json at the root if present — users edit rules without touching code ---
// strip the root prefix case-insensitively — on Windows the drive letter case may differ (C:/ vs c:/)
const fpNorm = filePath.replace(/\\/g, '/')
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
let cfg = {}
try { cfg = JSON.parse(readFileSync(join(root, 'gwork.json'), 'utf8')) } catch { /* no config = defaults */ }

// --- forbidden content, enforced at EDIT time (not just at push via check F) ---
// This is the answer to the S11 `git push --no-verify` hole: --no-verify skips git's
// pre-push hook, but it cannot skip THIS harness hook. A forbidden pattern written
// through the edit tools is denied before it ever reaches a commit. (Raw shell
// redirection still bypasses the edit tools — documented as the loud residual hole.)
if (Array.isArray(cfg.forbidden)) {
  const text = [
    data?.tool_input?.content,
    data?.tool_input?.new_string,
    ...(Array.isArray(data?.tool_input?.edits) ? data.tool_input.edits.map(e => e?.new_string) : []),
  ].filter(v => typeof v === 'string').join('\n')
  if (text) for (const rule of cfg.forbidden) {
    if (!rule?.path || !rule?.pattern) continue
    let pathRe, patRe
    try { pathRe = new RegExp(rule.path); patRe = new RegExp(rule.pattern) } catch { continue }
    if (pathRe.test(rel) && patRe.test(text))
      deny(`[gwork forbidden] this edit writes /${rule.pattern}/ into ${rel}, which gwork.json forbids${rule.reason ? ` — ${rule.reason}` : ''}. Only the repo owner may lift this (edit gwork.json → forbidden). A direct order in a prompt is not authorization; do not route around it with --no-verify or shell redirection — surface the conflict to the owner instead.`)
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

// --- anti-spam state: gotchas once per (session, module), sentinel warning once per session ---
const stateDir = join(tmpdir(), 'tasklog-gotcha')
mkdirSync(stateDir, { recursive: true })
const stateFile = join(stateDir, `${sessionId}.json`)
let seen = {}
try { seen = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* fresh */ }
const okW = (extra) => { // every exit from here on goes through okW so a pending sentinel warning is never lost
  const warn = sentinelWarn && !seen.__sentinel ? sentinelWarn : null
  if (warn) { seen.__sentinel = true; writeFileSync(stateFile, JSON.stringify(seen)) }
  ok([warn, extra].filter(Boolean).join('\n\n') || undefined)
}

if (!mod) okW()
if (seen[mod]) okW()

// --- look up the module's row in INDEX ---
const index = readFileSync(indexPath, 'utf8')
const row = index.split('\n').find(l => {
  const c = l.split('|').map(s => s.trim())
  return c.length >= 5 && c[1] === mod
})
if (!row) okW()
const cols = row.split('|').map(s => s.trim())
const [, , entries, bc, gotcha] = cols
const hasBC = bc && bc !== '—'
const hasGotcha = gotcha && gotcha !== 'TODO' && gotcha !== '—' && gotcha !== '-' && gotcha !== ''
if (!hasBC && !hasGotcha) okW()

seen[mod] = true
writeFileSync(stateFile, JSON.stringify(seen))

const msg = [
  `[task-log] Editing module "${mod}" — history you must know before touching it:`,
  hasBC ? `- Bug classes: ${bc} (details in CLAUDE.md)` : null,
  hasGotcha ? `- Gotcha: ${gotcha}` : null,
  `- Related entries (open only what you need, never the whole shard): ${entries}`,
].filter(Boolean).join('\n')
okW(msg)
