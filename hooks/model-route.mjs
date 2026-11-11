#!/usr/bin/env node
/**
 * model-route.mjs — which model should take a piece of work, judged from what the task touches.
 *
 * Two uses, one file (hooks are single-file on purpose — docs/adr/0002):
 *   as a hook   PreToolUse, matcher `Agent|Task`: when the main agent hands work to a subagent,
 *               score the task, compare with the model it chose, and say so when they differ.
 *   as a tool   node model-route.mjs --task "<what is to be done>" [--files a b …] [--json]
 *               prints the tier, the model and the reasons — for a person or an agent deciding
 *               which model to start a session on.
 *
 * The score is deterministic — no model is asked how hard a task is. Every task starts at 1:
 *   + breadth: the brief names 10 or more files (+2), or files in 4 or more modules (+1)
 *   + history: a module it touches has a bug class (+2) or a gotcha (+1) on record
 *   + words in the task statement that mark risk (+2) or open-ended work (+1)
 *   − words in the task statement that mark mechanical work (−2)
 * tier: light (≤0) · standard (1–3) · heavy (≥4)  →  haiku · sonnet · opus by default.
 *
 * What is and is not known (checked against real subagent briefs, L-018): breadth is the only
 * signal that tracked the effort subagents actually spent — briefs naming many files took about
 * twice the tool calls. The word lists are priors, not findings: they did not separate cheap
 * work from expensive work. Brief length and "a forbidden rule guards this path" were tried and
 * removed, because nearly every brief had both. So the hook also records what each subagent
 * really cost (PostToolUse), and gwork-stats shows effort per tier: if the tiers do not
 * separate, change the thresholds, not the story.
 *
 * It advises; it does not choose for the agent. gwork.json → routing.mode:
 *   "advise" (default)  context returned with the call when the chosen model and the tier differ
 *   "block-once"        the mismatched call is denied once with the recommendation; the same
 *                       call re-issued unchanged goes through (the agent has decided)
 *   "off"
 * Everything is tunable in gwork.json → routing (tiers, risky, openEnded, mechanical, heavyAt, standardAt) —
 * see ADAPT.md. Every judgment is logged to ~/.gwork/log so the thresholds can be checked
 * against what agents actually did (scripts/gwork-stats.mjs).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'

const T0 = Date.now()
const HOME = process.env.GWORK_HOME ?? join(homedir(), '.gwork')
const RANK = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }
const DEFAULTS = {
  mode: 'advise',
  tiers: { light: 'haiku', standard: 'sonnet', heavy: 'opus' },
  standardAt: 1, heavyAt: 4,
  // word lists are regular expressions, matched case-insensitively against the task text
  risky: ['schema', 'migrat', 'auth(?:entic|oriz)?', 'permission', 'rbac', 'security', 'secret', 'payment', 'billing', 'money', 'concurren', 'race condition', 'deadlock', 'transaction', 'architect', 'redesign', 'refactor', 'data ?loss', 'rollback', 'production', 'สิทธิ์', 'ฐานข้อมูล', 'การเงิน', 'ออกแบบ'],
  openEnded: ['investigat', 'debug', 'diagnos', 'root cause', 'why (?:does|is|do|did)', 'flaky', 'intermittent', 'figure out', 'หาสาเหตุ', 'ทำไม'],
  mechanical: ['typo', 'spelling', 'rename', 'format(?:ting)?\\b', 'lint', 'comment', '\\bdocs?\\b', 'readme', 'changelog', 'bump', 'close ?out', 'task-?log entry', 'แก้คำผิด', 'เปลี่ยนชื่อ', 'จัดรูปแบบ'],
}
const DEFAULT_MODULES = [
  { pattern: '^modules/([\\w-]+)/', name: '$1' },
  { pattern: '^(?:lib|app/actions)/([\\w-]+)', name: '(shim) $1' },
  { pattern: '^app/(?:visit/)?([\\w-]+)/', name: 'page:$1' },
  { pattern: '^components/([\\w-]+)/', name: 'ui:$1' },
  { pattern: '^tests/([\\w-]+)/', name: 'test:$1' },
  { pattern: '^(prisma|hooks|scripts)/', name: '$1' },
]
const str = (v) => (typeof v === 'string' ? v : '')
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const rootOf = (start) => {
  for (let dir = start; ; ) {
    if (existsSync(join(dir, 'task-log', 'INDEX.md'))) return dir
    const up = dirname(dir); if (up === dir) return null; dir = up
  }
}
const anyOf = (list, dflt) => {
  const src = (Array.isArray(list) ? list : dflt).filter(x => typeof x === 'string' && x)
  const good = src.filter(x => { try { new RegExp(x); return true } catch { return false } }) // a bad pattern in config is dropped, never thrown
  return good.length ? new RegExp(`(?:${good.join('|')})`, 'i') : null
}

// ---------- the judgment: pure, no I/O beyond reading the repo's own config and INDEX ----------
export function judge({ task, files = [], root, cwd }) {
  let cfg = {}
  try { cfg = JSON.parse(readFileSync(join(root, 'gwork.json'), 'utf8').replace(/^﻿/, '')) } catch { /* no config = defaults */ }
  if (!plain(cfg)) cfg = {}
  const r = plain(cfg.routing) ? cfg.routing : {}
  const mode = cfg.routing === false ? 'off' : ['advise', 'block-once', 'off'].includes(r.mode) ? r.mode : DEFAULTS.mode
  const tiers = { ...DEFAULTS.tiers, ...(plain(r.tiers) ? Object.fromEntries(Object.entries(r.tiers).filter(([k, v]) => k in DEFAULTS.tiers && typeof v === 'string' && v)) : {}) }
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const standardAt = num(r.standardAt, DEFAULTS.standardAt), heavyAt = Math.max(num(r.heavyAt, DEFAULTS.heavyAt), standardAt)

  // files: the ones passed in, plus anything in the task text that looks like a path in this repo
  const rootNorm = root.replace(/\\/g, '/') + '/'
  const rel = (p) => { const abs = resolve(cwd ?? root, p).replace(/\\/g, '/'); return abs.toLowerCase().startsWith(rootNorm.toLowerCase()) ? abs.slice(rootNorm.length) : null }
  const mentioned = task.match(/\/?(?:[\w.@~-]+\/)+[\w.@~-]+\.[A-Za-z0-9]{1,6}|\/?(?:[\w.@-]+\/){1,}[\w.@-]+\/?/g) ?? []
  const rels = [...new Set([...files, ...mentioned].map(f => rel(f.replace(/[.,;:)]+$/, '')) ?? (f.startsWith('/') ? null : f.replace(/^\.\//, ''))).filter(Boolean))].slice(0, 200)

  const rules = Array.isArray(cfg.modules) && cfg.modules.length ? cfg.modules : DEFAULT_MODULES
  const moduleOf = (p) => {
    for (const m of rules) {
      if (typeof m?.pattern !== 'string') continue
      let hit
      try { hit = p.match(new RegExp(m.pattern)) } catch { continue }
      if (hit) return String(m.name ?? '').replace(/\$(\d)/g, (_, i) => hit[+i] ?? '')
    }
    return null
  }
  const mods = [...new Set(rels.map(moduleOf).filter(Boolean))]

  let indexText = ''
  try { indexText = readFileSync(join(root, 'task-log', 'INDEX.md'), 'utf8') } catch { /* no INDEX = no history to weigh */ }
  const real = (v) => v && v !== 'TODO' && v !== '—' && v !== '-'
  const rows = indexText.split('\n').map(l => l.split(/(?<!\\)\|/).map(s => s.trim())).filter(c => c.length >= 5 && c[1] !== 'Module' && !/^:?-+:?$/.test(c[1]))
  const withBC = mods.filter(m => rows.some(c => c[1] === m && real(c[3])))
  const withGotcha = mods.filter(m => !withBC.includes(m) && rows.some(c => c[1] === m && real(c[4])))

  const reasons = []
  // Start at 1: with nothing known, work is ordinary, not trivial. Only words that mark it as
  // mechanical bring it down to the light tier.
  let score = 1
  const add = (n, why) => { score += n; reasons.push(`${n > 0 ? '+' : ''}${n} ${why}`) }
  if (rels.length >= 10) add(2, `the brief names ${rels.length} files`)
  if (mods.length >= 4) add(1, `touches ${mods.length} modules`)
  if (withBC.length) add(2, `a bug class is on record for ${withBC.join(', ')}`)
  if (withGotcha.length) add(1, `a gotcha is on record for ${withGotcha.slice(0, 3).join(', ')}`)
  // Words are read from the task STATEMENT — the description and the opening of the brief — and
  // from prose only. A long brief mentions "production" or "auth" somewhere whatever it is about,
  // and `lib/money/x.js` already counted as a module, not as the word "money".
  const head = task.slice(0, 500).replace(/(?:[\w.@~-]+\/)+[\w.@~-]*/g, ' ')
  const risky = anyOf(r.risky, DEFAULTS.risky), mech = anyOf(r.mechanical, DEFAULTS.mechanical), open = anyOf(r.openEnded, DEFAULTS.openEnded)
  const riskHit = risky && head.match(risky), mechHit = mech && head.match(mech), openHit = open && head.match(open)
  if (riskHit) add(2, `the task mentions "${riskHit[0].toLowerCase()}"`)
  if (openHit) add(1, `open-ended work ("${openHit[0].toLowerCase()}")`)
  if (mechHit) add(-2, `the task reads as mechanical ("${mechHit[0].toLowerCase()}")`)

  const tier = score >= heavyAt ? 'heavy' : score >= standardAt ? 'standard' : 'light'
  return { mode, tier, model: tiers[tier], score, reasons, modules: mods, files: rels.length }
}

// ---------- as a tool ----------
const argv = process.argv.slice(2)
if (argv.includes('--task')) {
  const at = (name) => { const i = argv.indexOf(`--${name}`); return i > -1 ? i : -1 }
  const task = str(argv[at('task') + 1])
  const fi = at('files')
  const files = fi > -1 ? argv.slice(fi + 1).filter(a => !a.startsWith('--')) : []
  const root = rootOf(process.cwd())
  if (!task) { console.error('model-route: --task needs a description'); process.exit(1) }
  if (!root) { console.error('model-route: no task-log/INDEX.md here or above — routing reads this repo\'s history'); process.exit(1) }
  const j = judge({ task, files, root, cwd: process.cwd() })
  if (argv.includes('--json')) console.log(JSON.stringify(j))
  else {
    console.log(`${j.tier} → ${j.model}  (score ${j.score})`)
    for (const why of j.reasons) console.log(`  ${why}`)
    if (!j.reasons.length) console.log('  nothing in the task or in this repo\'s history marks it as risky or wide')
  }
  process.exit(0)
}

// ---------- as a hook ----------
let data = {}
try { data = JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, '')) } catch { process.exit(0) }
if (!plain(data) || !['Agent', 'Task'].includes(data.tool_name) || !plain(data.tool_input)) process.exit(0)
const POST = data.hook_event_name === 'PostToolUse'
const task = [str(data.tool_input.description), str(data.tool_input.prompt)].filter(Boolean).join('\n')
if (!task) process.exit(0)
const cwd = str(data.cwd) || process.cwd()
// the repo: the session's own, else the first absolute path the brief names (a session opened elsewhere)
let root = rootOf(cwd)
if (!root) for (const p of task.match(/\/[\w.@~/-]+/g) ?? []) { root = rootOf(existsSync(p) ? p : dirname(p)); if (root) break }
if (!root) process.exit(0)

const j = judge({ task, root, cwd })
if (j.mode === 'off') process.exit(0)
// a named agent often carries its model in its name (worker-haiku, senior-sonnet): read both
const chosen = (str(data.tool_input.model) || str(data.tool_input.subagent_type)).toLowerCase()
const family = Object.keys(RANK).find(f => chosen.includes(f)) ?? ''
const want = Object.keys(RANK).find(f => j.model.toLowerCase().includes(f)) ?? ''
// under-powered: a named model weaker than the tier asks for. over-powered: two steps above it,
// or no model named (the subagent inherits the session's, usually the strongest) on a light task.
const verdict = !want || (chosen && !family) ? 'unknown' // a model or agent name this table does not know: no opinion
  : family && RANK[family] < RANK[want] ? 'under'
  : family && RANK[family] >= RANK[want] + 2 ? 'over'
  : !family && j.tier === 'light' ? 'over'
  : 'fits'

const sid = (str(data.session_id) || 'nosession').replace(/[^\w.-]/g, '_').slice(0, 120)
const logLine = (fields) => {
  try {
    if (process.env.GWORK_LOG === '0') return
    mkdirSync(join(HOME, 'log'), { recursive: true })
    appendFileSync(join(HOME, 'log', `${new Date().toISOString().slice(0, 7)}.jsonl`),
      JSON.stringify({ at: new Date().toISOString(), hook: 'route', event: POST ? 'PostToolUse' : 'PreToolUse', tool: data.tool_name, repo: root, session: sid, ...fields, ms: Date.now() - T0 }) + '\n')
  } catch { /* a log that cannot be written changes nothing */ }
}
// After the subagent returns: record what it actually cost, beside the tier it was given. This is
// the ground truth the thresholds are checked against; nothing is said to the model here.
if (POST) {
  const res = plain(data.tool_response) ? data.tool_response : {}
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  logLine({ action: 'route-result', tier: j.tier, score: j.score, chosen: chosen || '(inherited)', tokens: n(res.totalTokens), toolUses: n(res.totalToolUseCount), durationMs: n(res.totalDurationMs) })
  process.exit(0)
}
try {
  if (process.env.GWORK_LOG !== '0') {
    mkdirSync(join(HOME, 'log'), { recursive: true })
    appendFileSync(join(HOME, 'log', `${new Date().toISOString().slice(0, 7)}.jsonl`),
      JSON.stringify({ at: new Date().toISOString(), hook: 'route', event: 'PreToolUse', tool: data.tool_name, repo: root, session: sid, action: 'route', tier: j.tier, score: j.score, recommended: j.model, chosen: chosen || '(inherited)', verdict, ms: Date.now() - T0 }) + '\n')
  }
} catch { /* a log that cannot be written changes nothing */ }
if (verdict === 'fits' || verdict === 'unknown') process.exit(0)

const why = j.reasons.length ? j.reasons.map(x => x.replace(/^[+-]\d+ /, '')).join('; ') : 'nothing in the task or in this repo\'s history marks it as risky or wide'
const said = verdict === 'under'
  ? `[gwork routing] this subagent task scores "${j.tier}" (${why}). Recommended model: ${j.model}; you chose ${chosen}. A weaker model here is how the recorded mistakes get repeated.`
  : `[gwork routing] this subagent task scores "${j.tier}" (${why}). ${j.model} is enough; ${chosen ? `you chose ${chosen}` : 'no model was set, so it inherits this session\'s'}. Pass model: "${j.model}" for work like this.`

if (j.mode === 'block-once') {
  // deny the first mismatched call with the recommendation; the identical call re-issued goes through
  const key = `${family || '-'}|${j.tier}|${task.length}|${task.slice(0, 80)}`
  const stateFile = join(tmpdir(), 'gwork-model-route', `${sid}.json`)
  let seen = []
  try { const s = JSON.parse(readFileSync(stateFile, 'utf8')); if (Array.isArray(s)) seen = s } catch { /* fresh */ }
  if (!seen.includes(key)) {
    try { mkdirSync(dirname(stateFile), { recursive: true }); writeFileSync(stateFile, JSON.stringify([...seen, key].slice(-50))) } catch { /* block again at worst */ }
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${said} Re-issue the call with model: "${j.model}" — or unchanged, if you have a reason this judgment cannot see.` } }))
    process.exit(0)
  }
  process.exit(0)
}
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: said } }))
