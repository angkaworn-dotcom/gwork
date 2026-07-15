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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

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

// --- find the repo root that holds task-log/INDEX.md (walk up from cwd) ---
let root = cwd, indexPath = ''
for (let i = 0; i < 6; i++) {
  const p = join(root, 'task-log', 'INDEX.md')
  if (existsSync(p)) { indexPath = p; break }
  const up = dirname(root); if (up === root) break; root = up
}
if (!indexPath) allow()

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
if (!mod) allow()

// --- block once per (session, module); the retry passes ---
const stateDir = join(tmpdir(), 'tasklog-gotcha-hermes')
mkdirSync(stateDir, { recursive: true })
const stateFile = join(stateDir, `${sessionId}.json`)
let seen = {}
try { seen = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* fresh */ }
if (seen[mod]) allow()

// --- look up the module's row in INDEX ---
const index = readFileSync(indexPath, 'utf8')
const row = index.split('\n').find(l => {
  const c = l.split('|').map(s => s.trim())
  return c.length >= 5 && c[1] === mod
})
if (!row) allow()
const cols = row.split('|').map(s => s.trim())
const [, , entries, bc, gotcha] = cols
const hasBC = bc && bc !== '—'
const hasGotcha = gotcha && gotcha !== 'TODO' && gotcha !== '—' && gotcha !== '-' && gotcha !== ''
if (!hasBC && !hasGotcha) allow()

seen[mod] = true
writeFileSync(stateFile, JSON.stringify(seen))

block([
  `[task-log] Editing module "${mod}" — history you must know before touching it:`,
  hasBC ? `- Bug classes: ${bc} (details in CLAUDE.md)` : null,
  hasGotcha ? `- Gotcha: ${gotcha}` : null,
  `- Related entries (open only what you need, never the whole shard): ${entries}`,
  `This block fires once per module. Re-issue the same tool call now that you have read the above — it will be allowed.`,
].filter(Boolean).join('\n'))
