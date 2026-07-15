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
import { tmpdir } from 'node:os'

const ok = (extra) => { console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
    ...(extra ? { additionalContext: extra } : {}) } })); process.exit(0) }

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
if (!mod) ok()

// --- anti-spam: inject once per (session, module) ---
const stateDir = join(tmpdir(), 'tasklog-gotcha')
mkdirSync(stateDir, { recursive: true })
const stateFile = join(stateDir, `${sessionId}.json`)
let seen = {}
try { seen = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* fresh */ }
if (seen[mod]) ok()

// --- look up the module's row in INDEX ---
const index = readFileSync(indexPath, 'utf8')
const row = index.split('\n').find(l => {
  const c = l.split('|').map(s => s.trim())
  return c.length >= 5 && c[1] === mod
})
if (!row) ok()
const cols = row.split('|').map(s => s.trim())
const [, , entries, bc, gotcha] = cols
const hasBC = bc && bc !== '—'
const hasGotcha = gotcha && gotcha !== 'TODO' && gotcha !== ''
if (!hasBC && !hasGotcha) ok()

seen[mod] = true
writeFileSync(stateFile, JSON.stringify(seen))

const msg = [
  `[task-log] Editing module "${mod}" — history you must know before touching it:`,
  hasBC ? `- Bug classes: ${bc} (details in CLAUDE.md)` : null,
  hasGotcha ? `- Gotcha: ${gotcha}` : null,
  `- Related entries (open only what you need, never the whole shard): ${entries}`,
].filter(Boolean).join('\n')
ok(msg)
