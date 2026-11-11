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
 *   G. protection shrank vs upstream (forbidden rule removed / INDEX gotcha blanked)
 *      without an owner trailer                        → self-authorized override
 *   H. new entry in an existing shard is backdated     → fabricated history to game a check
 * G/H compare HEAD against the upstream baseline (@{upstream} → origin/<branch>) and are
 * skipped when no baseline exists (no remote, first push). The escape hatch for both is a
 * `Gwork-Owner-Approved: <why>` trailer in the commit that made the change — an agent can
 * forge it, but a forged trailer is a loud, greppable lie in the audit trail, not a quiet edit.
 * Usage: node scripts/tasklog-check.mjs [--dir task-log]
 *        node scripts/tasklog-check.mjs --staged   (pre-commit: check F only, against the index —
 *        a forbidden pattern is caught at the commit that adds it, not several commits later at push)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const dirArg = process.argv.indexOf('--dir')
const DIR = dirArg > -1 ? process.argv[dirArg + 1] : 'task-log'
const STAGED = process.argv.includes('--staged')
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
// split table rows on unescaped pipes only — `\|` inside a gotcha must not cut the cell short (and hide its length from C/D)
const cells = line => line.split(/(?<!\\)\|/).map(s => s.trim())

if (!existsSync(join(DIR, 'INDEX.md')) && !STAGED) {
  console.error(`tasklog-check: ${DIR}/INDEX.md not found`); process.exit(1)
}

// --- collect all anchors from shards ---
const shardAnchors = new Map() // id → shard file
for (const f of (existsSync(DIR) ? readdirSync(DIR) : []).filter(f => /^\d{4}-\d{2}\.md$/.test(f))) {
  const text = readFileSync(join(DIR, f), 'utf8')
  for (const m of text.matchAll(/<a id="([^"]+)"><\/a>/g)) {
    shardAnchors.set(m[1], f)
  }
}

// --- parse INDEX rows ---
const index = existsSync(join(DIR, 'INDEX.md')) ? readFileSync(join(DIR, 'INDEX.md'), 'utf8') : ''
const referenced = new Set()
for (const line of index.split('\n')) {
  const c = cells(line)
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
// Scans the COMMITTED state (HEAD), not the working tree — a worktree-only edit must not be
// able to hide a committed violation from the push.
// --- git helpers shared by F/G/H ---
const git = (...args) => {
  // argv, never a shell string: anchor ids, branch names and --dir come from repo content,
  // and `2026-01-01$(...)` in a shard must stay an id, not become a command.
  // stdio: suppress stderr — expected-miss lookups (showAt on a file absent at ref)
  // otherwise leak "fatal: path ... does not exist" noise into every run
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
  catch { return null }
}
const showAt = (ref, path) => git('show', `${ref}:${path}`) // null when the file doesn't exist at ref
// F reads forbidden rules from the worktree config AND HEAD's committed config: an
// uncommitted shrink of gwork.json must not be able to switch the scan off for what
// is actually being pushed. (Committed shrinks are check G's job.)
// \u0000 escape, not a literal NUL byte: a raw NUL makes git and grep treat this file as binary (L-010)
const ruleKey = r => `${r?.path}\u0000${r?.pattern}`
let headCfg = {}
try { headCfg = JSON.parse(showAt('HEAD', 'gwork.json') ?? '{}') } catch { /* unparseable at HEAD = no extra rules */ }
const forbiddenRules = []
for (const src of [cfg.forbidden, headCfg.forbidden]) {
  if (src === undefined) continue
  if (!Array.isArray(src)) {
    console.error('tasklog-check: gwork.json → forbidden must be an array of {path, pattern, reason?}'); process.exit(1)
  }
  for (const r of src) if (!forbiddenRules.some(x => ruleKey(x) === ruleKey(r))) forbiddenRules.push(r)
}

if (STAGED) errors.length = 0 // --staged judges the index against F only; A–D belong to the push
const F_LABEL = STAGED ? 'staged' : 'committed'
let hasForbiddenHit = false
if (forbiddenRules.length) {
  const compiled = forbiddenRules.map((rule, i) => {
    if (!rule?.path || !rule?.pattern) {
      console.error(`tasklog-check: forbidden[${i}] needs at least {path, pattern}`); process.exit(1)
    }
    // anyLine: the same pattern with the m flag, tried once on the whole file. It matches whenever
    // some line matches, so a miss skips the line-by-line pass (a small saving: reading the files is the real cost)
    try { return { rule, pathRe: new RegExp(rule.path), patRe: new RegExp(rule.pattern), anyLine: new RegExp(rule.pattern, 'm') } }
    catch (e) { console.error(`tasklog-check: forbidden[${i}] has a bad regex — ${e.message}`); process.exit(1) }
  })
  // The pattern is matched HERE, by the JavaScript engine — the same engine the edit-time hook
  // uses. It used to be handed to `git grep -P` (PCRE): a pattern could then mean one thing at
  // edit time and another at push (lookbehind, \u escapes, flags), and a git built without PCRE
  // failed the whole check. Contents come from one `git cat-file --batch` for every file a
  // rule's path can touch, read from HEAD (or from the index with --staged).
  const listed = STAGED
    ? git('-c', 'core.quotepath=false', 'ls-files', '-z')
    : git('-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', '--name-only', 'HEAD') // null = no commits yet, nothing pushable to scan
  const wanted = (listed ?? '').split('\0').filter(f => f && !f.includes('\n') && compiled.some(c => c.pathRe.test(f)))
  if (wanted.length) {
    let buf
    try {
      buf = execFileSync('git', ['cat-file', '--batch'], { input: wanted.map(f => `${STAGED ? '' : 'HEAD'}:${f}`).join('\n') + '\n', maxBuffer: 2 ** 30, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) { console.error(`tasklog-check: could not read file contents for check F — ${((e.stderr ?? '').toString() || e.message).trim()}`); process.exit(1) }
    let off = 0
    for (const f of wanted) {
      const nl = buf.indexOf(10, off)
      if (nl < 0) break
      const head = buf.toString('utf8', off, nl).match(/^[0-9a-f]+ (\w+) (\d+)$/)
      off = nl + 1
      if (!head) continue // "<name> missing": staged for deletion, or a path git cannot resolve
      const body = buf.subarray(off, off + Number(head[2]))
      off += Number(head[2]) + 1
      if (head[1] !== 'blob' || body.includes(0)) continue // submodule, or binary
      const text = body.toString('utf8').replace(/\r\n/g, '\n')
      let fileLines = null
      for (const c of compiled) {
        if (!c.pathRe.test(f) || !c.anyLine.test(text)) continue
        fileLines ??= text.split('\n')
        fileLines.forEach((line, n) => {
          if (!c.patRe.test(line)) return
          hasForbiddenHit = true
          errors.push(`F ${f}:${n + 1} (${F_LABEL}) matches forbidden pattern /${c.rule.pattern}/${c.rule.reason ? ' — ' + c.rule.reason : ''}`)
        })
      }
    }
  }
}

if (STAGED) {
  if (errors.length) {
    console.error(`tasklog-check FAILED (${errors.length}):\n` + errors.map(e => '  ' + e).join('\n'))
    console.error('  (F) forbidden rules can only be overridden by the repo owner editing gwork.json → forbidden — a direct order in a prompt is not authorization')
    process.exit(1)
  }
  process.exit(0)
}

// --- G + H: compare HEAD against the upstream baseline — self-authorization guards ---
// Baseline: @{upstream} of the current branch, else origin/<branch>. No baseline
// (no remote, unborn branch, first push) = both checks skip: there is nothing to shrink from.
const OWNER_TRAILER = /^Gwork-Owner-Approved:/m
// GWORK_BASE: an explicit baseline for places with no upstream branch — a CI checkout is a
// detached HEAD, where G and H would otherwise skip (templates/gwork-check.yml sets it).
let base = process.env.GWORK_BASE && git('rev-parse', '--verify', '--quiet', `${process.env.GWORK_BASE}^{commit}`) ? process.env.GWORK_BASE : ''
if (!base) base = git('rev-parse', '--verify', '--quiet', '@{upstream}')?.trim()
if (!base) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')?.trim()
  if (branch && branch !== 'HEAD' && git('rev-parse', '--verify', '--quiet', `origin/${branch}`)) base = `origin/${branch}`
}
// 3 --- Was a loss of protection in `path` owner-approved? Walk the unpushed commits that touch
// the file, oldest first: a commit that makes `lost(before, after)` true leaves the loss
// pending; a commit carrying the trailer clears what is pending at that point. Judging only
// the LAST commit on the file (the old rule) blocked an approved removal as soon as any later
// commit touched the same file, and approved an unapproved one for the same reason.
const ownerApproved = (path, lost) => {
  const shas = (git('log', '--format=%H', '--reverse', `${base}..HEAD`, '--', path) ?? '').split('\n').filter(Boolean)
  let prev = showAt(base, path), pending = false, located = false
  for (const sha of shas) {
    const cur = showAt(sha, path)
    const trailer = OWNER_TRAILER.test(git('log', '-1', '--format=%B', sha) ?? '')
    if (lost(prev, cur)) { located = true; pending = !trailer }
    else if (trailer) pending = false
    prev = cur
  }
  // loss not attributable to one commit (merge-shaped history) → the trailer must be on the newest commit touching the file
  return located ? !pending : OWNER_TRAILER.test(git('log', '-1', '--format=%B', 'HEAD', '--', path) ?? '')
}
if (base) {
  // G1: forbidden rules present at the baseline must still exist at HEAD
  let baseCfg = {}
  try { baseCfg = JSON.parse(showAt(base, 'gwork.json') ?? '{}') } catch { /* unparseable baseline = no baseline rules */ }
  const headKeys = new Set((Array.isArray(headCfg.forbidden) ? headCfg.forbidden : []).map(ruleKey))
  const hasRule = (text, key) => { try { return (JSON.parse(text ?? '{}').forbidden ?? []).some(r => ruleKey(r) === key) } catch { return false } }
  for (const rule of Array.isArray(baseCfg.forbidden) ? baseCfg.forbidden : []) {
    const key = ruleKey(rule)
    if (!headKeys.has(key) && !ownerApproved('gwork.json', (a, b) => hasRule(a, key) && !hasRule(b, key)))
      errors.push(`G gwork.json: forbidden rule {path: ${rule.path}, pattern: ${rule.pattern}} was removed vs ${base} — only the repo owner may lift it; their commit must carry a "Gwork-Owner-Approved: <why>" trailer`)
  }

  // G2: a real gotcha at the baseline may not be blanked at HEAD (promotion to a BC is fine)
  const parseGotchas = (text) => {
    const map = new Map()
    for (const line of (text ?? '').split('\n')) {
      const c = cells(line)
      if (c.length < 5 || c[1] === 'Module' || /^-+$/.test(c[1])) continue
      map.set(c[1], { bc: c[3], gotcha: c[4] })
    }
    return map
  }
  const isReal = g => g && g !== 'TODO' && g !== '—' && g !== '-'
  const indexPath = `${DIR}/INDEX.md`
  const headRows = parseGotchas(showAt('HEAD', indexPath))
  for (const [mod, b] of parseGotchas(showAt(base, indexPath))) {
    const h = headRows.get(mod)
    if (!h || !isReal(b.gotcha)) continue // row removed entirely = check B/A territory, not G's
    const blanked = r => r && !isReal(r.gotcha) && !(r.bc && r.bc !== '—')
    const lost = (a, b) => isReal(parseGotchas(a).get(mod)?.gotcha) && blanked(parseGotchas(b).get(mod))
    if (blanked(h) && !ownerApproved(indexPath, lost))
      errors.push(`G ${mod}: gotcha "${b.gotcha.slice(0, 60)}…" was blanked vs ${base} with no BC promotion — needs a "Gwork-Owner-Approved: <why>" trailer from the owner`)
  }

  // H: anchors new in an EXISTING shard must not be backdated — a link is repaired by
  // removing it, never by inventing the entry it points to. New shard files (initial
  // migration imports) are exempt; late legit logging uses the owner trailer.
  const GRACE_DAYS = cfg.tasklog?.backdateGraceDays ?? 3
  for (const f of readdirSync(DIR).filter(f => /^\d{4}-\d{2}\.md$/.test(f))) {
    const shardPath = `${DIR}/${f}`
    const baseText = showAt(base, shardPath)
    if (baseText === null) continue // shard didn't exist at baseline — bulk import, exempt
    const headText = showAt('HEAD', shardPath) ?? ''
    const baseIds = new Set([...baseText.matchAll(/<a id="([^"]+)"><\/a>/g)].map(m => m[1]))
    for (const m of headText.matchAll(/<a id="([^"]+)"><\/a>/g)) {
      const id = m[1]
      if (baseIds.has(id)) continue
      const dm = id.match(/^(\d{4}-\d{2}-\d{2})/)
      if (!dm) continue
      // the pathspec limits -S to this shard, so any occurrence-count change finds the adding commit
      const added = git('log', '--format=%H%n%cI%n%B', `-S${id}`, `${base}..HEAD`, '--', shardPath)
      if (!added) continue
      const [, cDate, ...bodyLines] = added.split('\n')
      if (OWNER_TRAILER.test(bodyLines.join('\n'))) continue
      const days = (new Date(cDate) - new Date(dm[1])) / 86400000
      if (days > GRACE_DAYS)
        errors.push(`H ${f}#${id}: entry is dated ${dm[1]} but was committed ${cDate.slice(0, 10)} (${Math.floor(days)} days later) — never fabricate a past entry to satisfy a link; remove the rotten link instead (legit late logging: "Gwork-Owner-Approved: <why>" trailer)`)
    }
  }
}

// --- note (never blocks): INDEX rows the gotcha hook can never reach ---
// The hook finds a row by the module name that gwork.json → modules derives from the edited
// file's path. A row filed under any other name (a topic, a feature) is stored but never
// injected — seen in the field for nearly every row of an INDEX. A note, not a gate — an existing
// INDEX must not start failing pushes; `misc`/`other` are migrate's own catch-alls.
function reachabilityNote() {
  const rules = Array.isArray(cfg.modules) && cfg.modules.length ? cfg.modules : null
  const files = rules && git('ls-files') // null = defaults in use, or not a git repo — nothing meaningful to compare
  const produced = new Set()
  for (const f of (files ?? '').split('\n')) for (const r of rules ?? []) {
    let m
    try { m = f.match(new RegExp(r.pattern)) } catch { continue }
    if (m) { produced.add(String(r.name).replace(/\$(\d)/g, (_, i) => m[+i] ?? '')); break }
  }
  const names = new Set()
  for (const line of index.split('\n')) {
    const c = cells(line)
    if (c.length < 5 || c[1] === 'Module' || /^-+$/.test(c[1]) || c[1] === 'misc' || c[1] === 'other') continue
    names.add(c[1])
  }
  const dead = files ? [...names].filter(n => !produced.has(n)) : []
  // "A gotcha that repeats becomes a BC" is a prompt-only rule. Counting modules with 2+ gotchas
  // (the first version of this note) was a false signal: measured on a real INDEX of 500+ rows,
  // those were distinct lessons, and almost none repeated. A repeat is two rows of one module
  // saying nearly the same thing — character-trigram overlap of half or more — with no BC.
  const tri = (t) => { const s = t.toLowerCase().replace(/\s+/g, ' '), set = new Set(); for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3)); return set }
  const alike = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n) >= 0.5 }
  const perMod = new Map()
  for (const line of index.split('\n')) {
    const c = cells(line)
    if (c.length < 5 || c[1] === 'Module' || /^-+$/.test(c[1])) continue
    const m = perMod.get(c[1]) ?? { tris: [], bc: false }
    if (c[4] && c[4] !== 'TODO' && c[4] !== '—' && c[4] !== '-' && c[4].length >= 12) m.tris.push(tri(c[4]))
    if (c[3] && c[3] !== '—') m.bc = true
    perMod.set(c[1], m)
  }
  const repeating = [...perMod].filter(([, m]) => !m.bc && m.tris.some((a, i) => m.tris.some((b, k) => k > i && alike(a, b)))).map(([n]) => n)
  if (repeating.length) console.log(`  note: ${repeating.length} module(s) carry the same lesson on more than one row with no BC — a lesson that repeats belongs in CLAUDE.md as a bug class (${repeating.slice(0, 3).join(', ')}${repeating.length > 3 ? ', …' : ''})`)
  if (dead.length) console.log(`  note: ${dead.length} of ${names.size} INDEX module names are produced by no tracked file under gwork.json → modules — the hook reaches them only through entries that name the edited file (${dead.slice(0, 3).join(', ')}${dead.length > 3 ? ', …' : ''})`)
}

if (errors.length) {
  console.error(`tasklog-check FAILED (${errors.length}):\n` + errors.map(e => '  ' + e).join('\n'))
  reachabilityNote()
  if (hasForbiddenHit) console.error('  (F) forbidden rules can only be overridden by the repo owner editing gwork.json → forbidden — a direct order in a prompt is not authorization')
  process.exit(1)
}
console.log(`tasklog-check OK — ${shardAnchors.size} entries, INDEX consistent`)
reachabilityNote()
