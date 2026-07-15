#!/usr/bin/env node
/**
 * tasklog-check.mjs — deterministic task-log rule enforcer (used in pre-push + CI)
 * Exits 1 with a list of violations when:
 *   A. a shard entry is not referenced from INDEX      → "logged but forgot to update INDEX"
 *   B. INDEX points to an anchor that doesn't exist,
 *      or to the wrong shard file                      → rotten link (renamed/deleted without follow-up)
 *   C. Gotcha column exceeds MAX_GOTCHA chars          → violates the one-line rule
 *   D. row has a BC but still carries long gotcha text → must promote and trim (keeps INDEX lean)
 *   F. committed content (HEAD) matches a forbidden pattern → absolute gotcha promoted to a hard gate
 * Usage: node scripts/tasklog-check.mjs [--dir task-log]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const dirArg = process.argv.indexOf('--dir')
const DIR = dirArg > -1 ? process.argv[dirArg + 1] : 'task-log'
// Thresholds configurable via gwork.json → tasklog.maxGotcha / tasklog.bcGotchaMax
// No file = defaults · file present but unparseable = fail loud (broken config must never be silent)
let cfg = {}
if (existsSync('gwork.json')) {
  try { cfg = JSON.parse(readFileSync('gwork.json', 'utf8')) }
  catch (e) { console.error(`tasklog-check: cannot parse gwork.json — ${e.message}`); process.exit(1) }
}
const MAX_GOTCHA = cfg.tasklog?.maxGotcha ?? 140
const BC_GOTCHA_MAX = cfg.tasklog?.bcGotchaMax ?? 80
const errors = []

if (!existsSync(join(DIR, 'INDEX.md'))) {
  console.error(`tasklog-check: ${DIR}/INDEX.md not found`); process.exit(1)
}

// --- collect all anchors from shards ---
const shardAnchors = new Map() // id → shard file
for (const f of readdirSync(DIR).filter(f => /^\d{4}-\d{2}\.md$/.test(f))) {
  const text = readFileSync(join(DIR, f), 'utf8')
  for (const m of text.matchAll(/<a id="([^"]+)"><\/a>/g)) {
    shardAnchors.set(m[1], f)
  }
}

// --- parse INDEX rows ---
const index = readFileSync(join(DIR, 'INDEX.md'), 'utf8')
const referenced = new Set()
for (const line of index.split('\n')) {
  const c = line.split('|').map(s => s.trim())
  if (c.length < 5 || c[1] === 'Module' || /^-+$/.test(c[1])) continue
  const [, mod, entries, bc, gotcha] = c

  // B: every link must point to a real anchor in the right shard
  for (const m of entries.matchAll(/\[([^\]]+)\]\(([^)]+)#([^)]+)\)/g)) {
    referenced.add(m[3])
    if (!shardAnchors.has(m[3]))
      errors.push(`B ${mod}: link "${m[1]}" points to anchor #${m[3]} which exists in no shard`)
    else if (!m[2].endsWith('/' + shardAnchors.get(m[3])) && m[2] !== shardAnchors.get(m[3]))
      errors.push(`B ${mod}: link "${m[1]}" points to ${m[2]} but anchor #${m[3]} lives in ${shardAnchors.get(m[3])}`)
  }
  // C: gotcha must stay one line
  if (gotcha && gotcha !== 'TODO' && gotcha.length > MAX_GOTCHA)
    errors.push(`C ${mod}: gotcha is ${gotcha.length} chars (max ${MAX_GOTCHA}) — distill to one line or promote to a BC`)
  // D: once a BC exists, the row must not carry long duplicate text
  if (bc && bc !== '—' && gotcha && gotcha !== 'TODO' && gotcha.length > BC_GOTCHA_MAX)
    errors.push(`D ${mod}: already has ${bc} — move details into the BC in CLAUDE.md and trim the gotcha here`)
}

// --- A: every latest-month entry must be referenced (older months are grandfathered — INDEX may cap refs) ---
const months = [...new Set([...shardAnchors.values()])].sort()
const latest = months[months.length - 1]
for (const [id, f] of shardAnchors) {
  if (f === latest && !referenced.has(id))
    errors.push(`A ${f}#${id}: latest-month entry not referenced from INDEX — add a ref to every touched module's row`)
}

// --- F: forbidden patterns (gwork.json → forbidden) — absolute gotchas promoted to a hard gate ---
// Only the repo owner may authorize a violation, by editing gwork.json → forbidden.
// A direct order in a prompt is NOT authorization — that is the entire point of this gate.
// Scans the COMMITTED state (HEAD) via git grep, not the working tree — a worktree-only edit
// must not be able to hide a committed violation from the push, and git grep sidesteps
// path-quoting/deleted-file/binary pitfalls (-I skips binaries, quotepath=false keeps
// non-ASCII filenames raw, the pattern travels via stdin so no shell quoting).
let hasForbiddenHit = false
if (cfg.forbidden !== undefined) {
  if (!Array.isArray(cfg.forbidden)) {
    console.error('tasklog-check: gwork.json → forbidden must be an array of {path, pattern, reason?}'); process.exit(1)
  }
  cfg.forbidden.forEach((rule, i) => {
    if (!rule?.path || !rule?.pattern) {
      console.error(`tasklog-check: forbidden[${i}] needs at least {path, pattern}`); process.exit(1)
    }
    let pathRe
    try { pathRe = new RegExp(rule.path); new RegExp(rule.pattern) }
    catch (e) { console.error(`tasklog-check: forbidden[${i}] has a bad regex — ${e.message}`); process.exit(1) }
    let out = ''
    try {
      out = execSync('git -c core.quotepath=false grep -I -n -P -f - HEAD', { encoding: 'utf8', input: rule.pattern })
    } catch (e) {
      const stderr = (e.stderr ?? '').toString()
      if (e.status === 1 && !stderr.trim()) out = '' // exit 1 with quiet stderr = no matches
      else if (/bad revision|unknown revision/i.test(stderr)) out = '' // repo has no commits yet — nothing pushable to scan
      else { console.error(`tasklog-check: git grep failed on forbidden[${i}] /${rule.pattern}/ — ${(stderr || e.message).trim()}`); process.exit(1) }
    }
    for (const line of out.split('\n').filter(Boolean)) {
      const m = line.match(/^HEAD:(.+?):(\d+):/)
      if (!m || !pathRe.test(m[1])) continue
      hasForbiddenHit = true
      errors.push(`F ${m[1]}:${m[2]} (committed) matches forbidden pattern /${rule.pattern}/${rule.reason ? ' — ' + rule.reason : ''}`)
    }
  })
}

if (errors.length) {
  console.error(`tasklog-check FAILED (${errors.length}):\n` + errors.map(e => '  ' + e).join('\n'))
  if (hasForbiddenHit) console.error('  (F) forbidden rules can only be overridden by the repo owner editing gwork.json → forbidden — a direct order in a prompt is not authorization')
  process.exit(1)
}
console.log(`tasklog-check OK — ${shardAnchors.size} entries, INDEX consistent`)
