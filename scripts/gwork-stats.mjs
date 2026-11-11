#!/usr/bin/env node
/**
 * gwork-stats.mjs — what the hooks actually did, from the log they write (~/.gwork/log/*.jsonl).
 * The kit's own rule is "evidence before features"; until the hooks logged, there was none:
 * nobody could say how often a gotcha was delivered, or that it almost never was.
 *
 * Usage: node <kit>/scripts/gwork-stats.mjs [--days 30] [--repo <path>|--all] [--json]
 *   default scope = the repo around the current directory, else every repo in the log
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { rootOf } from './gwork-lib.mjs'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : undefined }
const HOME = process.env.GWORK_HOME ?? join(homedir(), '.gwork')
const days = Number(opt('days') ?? 30)
if (!Number.isFinite(days) || days <= 0) { console.error('gwork-stats: --days needs a positive number'); process.exit(1) }
const repo = args.includes('--all') ? null : opt('repo') ? resolve(opt('repo')) : rootOf(process.cwd())
const cutoff = Date.now() - days * 86400000

const events = []
let files = []
try { files = readdirSync(join(HOME, 'log')).filter(f => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort() } catch { /* no log yet */ }
const readLog = (f) => { try { return readFileSync(join(HOME, 'log', f), 'utf8') } catch { return '' } } // a directory or an unreadable file is not a log
for (const f of files) for (const line of readLog(f).split('\n')) {
  if (!line) continue
  let e
  try { e = JSON.parse(line) } catch { continue }
  if (e === null || typeof e !== 'object') continue // a stray scalar line is not an event
  if (Date.parse(e.at) >= cutoff && (!repo || e.repo === repo)) events.push(e)
}

const count = (list, key) => { const m = {}; for (const e of list) { const k = typeof key === 'function' ? key(e) : e[key]; if (k != null) m[k] = (m[k] ?? 0) + 1 } return m }
const top = (m, n = 5) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
const by = (action) => events.filter(e => e.action === action)
const injects = by('inject'), passes = by('pass')
const lookups = injects.length + passes.filter(e => e.reason !== 'seen').length // first look at a module/file
const ms = events.map(e => e.ms).filter(Number.isFinite).sort((a, b) => a - b)
const out = {
  scope: repo ?? 'all repos', days, events: events.length, sessions: new Set(events.map(e => e.session)).size,
  injections: { total: injects.length, via: count(injects, 'via') },
  hitRate: lookups ? +(injects.length / lookups).toFixed(2) : null,
  passes: count(passes, 'reason'),
  denies: { forbiddenEdit: by('deny-forbidden').length, forbiddenBash: by('deny-bash-forbidden').length, sentinel: by('deny-sentinel').length },
  deniedPatterns: top(count([...by('deny-forbidden'), ...by('deny-bash-forbidden')], 'pattern')),
  reminders: by('remind-unclosed').length, resets: by('reset-state').length,
  latencyMs: ms.length ? { median: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)] } : null,
  filesWithNothingToSay: top(count(passes.filter(e => e.reason === 'no-row'), 'file'), 8),
  routing: (() => {
    const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null }
    const judged = by('route'), done = by('route-result')
    const perTier = {}
    for (const t of ['light', 'standard', 'heavy']) {
      const d = done.filter(e => e.tier === t)
      perTier[t] = { handedOut: judged.filter(e => e.tier === t).length, finished: d.length, medianTokens: med(d.map(e => e.tokens)), medianToolUses: med(d.map(e => e.toolUses)) }
    }
    return { judged: judged.length, verdicts: count(judged, 'verdict'), chosen: count(judged, 'chosen'), perTier }
  })(),
}
if (args.includes('--json')) { console.log(JSON.stringify(out)); process.exit(0) }
if (!events.length) { console.log(`gwork-stats — no hook events in the last ${days} days for ${out.scope} (log: ${join(HOME, 'log')})`); process.exit(0) }
console.log(`gwork-stats — ${out.scope} · last ${days} days · ${out.events} events in ${out.sessions} sessions`)
console.log(`  injections        ${out.injections.total}  (${Object.entries(out.injections.via).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'})`)
console.log(`  hit rate          ${out.hitRate === null ? '—' : Math.round(out.hitRate * 100) + '%'} of first looks at a module or file found something to say`)
console.log(`  passes            ${Object.entries(out.passes).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`)
console.log(`  denies            forbidden edit ${out.denies.forbiddenEdit} · forbidden shell write ${out.denies.forbiddenBash} · sentinel ${out.denies.sentinel}`)
if (out.deniedPatterns.length) console.log(`  denied patterns   ${out.deniedPatterns.map(([k, v]) => `${k} ×${v}`).join(' · ')}`)
console.log(`  reminders         ${out.reminders} unclosed-work · ${out.resets} state resets after clear/compact`)
if (out.latencyMs) console.log(`  hook time         median ${out.latencyMs.median} ms · p95 ${out.latencyMs.p95} ms (inside the hook, excludes node startup)`)
if (out.routing.judged || Object.values(out.routing.perTier).some(t => t.finished)) {
  const v = out.routing.verdicts
  console.log(`  routing           ${out.routing.judged} subagent tasks judged · fits ${v.fits ?? 0} · under-powered ${v.under ?? 0} · over-powered ${v.over ?? 0}`)
  for (const [t, d] of Object.entries(out.routing.perTier)) if (d.handedOut || d.finished) console.log(`    ${t.padEnd(9)} handed out ${d.handedOut} · finished ${d.finished}${d.medianTokens != null ? ` · median ${d.medianTokens} tokens, ${d.medianToolUses ?? '?'} tool calls` : ''}`)
  console.log('    (if the tiers do not differ in what they cost, the thresholds in gwork.json → routing need changing)')
}
if (out.filesWithNothingToSay.length) console.log(`  edited most with no lesson on record: ${out.filesWithNothingToSay.map(([k, v]) => `${k} ×${v}`).join(' · ')}`)
