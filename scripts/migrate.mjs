#!/usr/bin/env node
/**
 * migrate.mjs — splits an append-only log (e.g. `update task.md`) into:
 *   task-log/YYYY-MM.md   (monthly shards, every original entry + stable anchor ids)
 *   task-log/INDEX.md     (dict: module → entries → BC → one-line gotcha [filled by hand])
 * Never modifies the source file — writes results into task-log/ only.
 * Usage: node migrate.mjs "update task.md"
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const src = process.argv[2] ?? 'update task.md'
const raw = readFileSync(src, 'utf8')

// --- 1. split entries by "## " headers ---
const lines = raw.split('\n')
const entries = []
let cur = null
for (const line of lines) {
  const m = line.match(/^## (\d{4}-\d{2}-\d{2})(?:\s*\((\d+)\))?\s*[—-]?\s*(.*)$/)
  if (m) {
    if (cur) entries.push(cur)
    cur = { date: m[1], seq: m[2] ?? '', title: m[3].trim(), body: [line] }
  } else if (cur) {
    cur.body.push(line)
  }
}
if (cur) entries.push(cur)
console.log(`parsed ${entries.length} entries`)

// --- 2. stable anchor id ---
for (const e of entries) {
  e.id = e.seq ? `${e.date}-${e.seq}` : e.date
}
// dedupe ids (same date, no seq, multiple entries)
const seen = new Map()
for (const e of entries) {
  const n = (seen.get(e.id) ?? 0) + 1
  seen.set(e.id, n)
  if (n > 1) e.id = `${e.id}-${String.fromCharCode(95 + n)}` // 2nd → -a, 3rd → -b, ...
}

// --- 3. extract touched modules/paths per entry ---
// Rules come from gwork.json at the root if present (shared with hooks/tasklog-gotcha.mjs) — defaults otherwise
const DEFAULT_MODULES = [
  { pattern: '^modules/([\\w-]+)/', name: '$1' },
  { pattern: '^(?:lib|app/actions)/([\\w-]+)', name: '(shim) $1' },
  { pattern: '^app/(?:visit/)?([\\w-]+)/', name: 'page:$1' },
  { pattern: '^components/([\\w-]+)/', name: 'ui:$1' },
  { pattern: '^tests/([\\w-]+)/', name: 'test:$1' },
  { pattern: '^(prisma|hooks|scripts)/', name: '$1' },
]
let cfg = {}
if (existsSync('gwork.json')) {
  try { cfg = JSON.parse(readFileSync('gwork.json', 'utf8')) }
  catch (e) { console.error(`migrate: cannot parse gwork.json — ${e.message}`); process.exit(1) }
}
const PATH_RE = new RegExp(cfg.pathPattern
  ?? '(?:modules|app|lib|components|prisma|tests|hooks|scripts)/[\\w\\-./[\\]]+\\.(?:tsx?|mjs|prisma|json|md)', 'g')
const moduleRules = Array.isArray(cfg.modules) && cfg.modules.length ? cfg.modules : DEFAULT_MODULES
const moduleOf = p => {
  for (const r of moduleRules) {
    const m = p.match(new RegExp(r.pattern))
    if (m) return r.name.replace(/\$(\d)/g, (_, i) => m[+i] ?? '')
  }
  return 'other'
}
for (const e of entries) {
  const text = e.body.join('\n')
  e.paths = [...new Set(text.match(PATH_RE) ?? [])]
  e.modules = [...new Set(e.paths.map(moduleOf))]
  if (e.modules.length === 0) e.modules = ['misc']  // entry with no paths → misc row so INDEX never drops it
  e.bcs = [...new Set(text.match(/BC-\d{3}/g) ?? [])]
}

// --- 4. write monthly shards (chronological asc within file) ---
const outDir = 'task-log'
mkdirSync(outDir, { recursive: true })
const byMonth = new Map()
for (const e of entries) {
  const mo = e.date.slice(0, 7)
  if (!byMonth.has(mo)) byMonth.set(mo, [])
  byMonth.get(mo).push(e)
}
for (const [mo, list] of byMonth) {
  list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) // numeric so -10 sorts after -2
  const out = list.map(e => {
    const [h, ...rest] = e.body
    return `<a id="${e.id}"></a>\n${h}\n${rest.join('\n')}`.trimEnd()
  }).join('\n\n---\n\n') + '\n'
  writeFileSync(join(outDir, `${mo}.md`), out)
  console.log(`  ${mo}.md  (${list.length} entries)`)
}

// --- 5. build INDEX: module → rows ---
const idx = new Map() // module → [{id, mo, bcs, title}]
for (const e of entries) {
  for (const mod of e.modules) {
    if (!idx.has(mod)) idx.set(mod, [])
    idx.get(mod).push(e)
  }
}
const rows = [...idx.entries()].sort((a, b) => b[1].length - a[1].length)
let md = `# task-log INDEX (dict — look up before touching a module, never read a whole shard)

> How to use: find the module you are about to touch → open only the entries it points to (\`task-log/YYYY-MM.md#anchor\`)
> Bloat rules: gotcha per row ≤ 1 line · a module whose gotcha repeats ≥2 times, or one destructive incident → promote to a BC in CLAUDE.md and keep only the BC number here
> Gotcha column is TODO after migrate — fill from memory/real entries only for rows with real lessons; routine rows may stay empty

| Module | Entries (latest first) | BC | Gotcha (≤1 line) |
|---|---|---|---|
`
for (const [mod, list] of rows) {
  const uniq = [...new Map(list.map(e => [e.id, e])).values()]
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))
  const latestMo = uniq[0]?.date.slice(0, 7)
  const recent = uniq.filter(e => e.date.slice(0, 7) === latestMo)
  const older = uniq.filter(e => e.date.slice(0, 7) !== latestMo)
  const kept = [...recent, ...older.slice(0, Math.max(0, 6 - recent.length))]
  const refs = kept.map(e => `[${e.id}](task-log/${e.date.slice(0,7)}.md#${e.id})`).join(' · ')
    + (uniq.length > kept.length ? ` · +${uniq.length - kept.length}` : '')
  const bcs = [...new Set(list.flatMap(e => e.bcs))].join(' ') || '—'
  md += `| ${mod} | ${refs} | ${bcs} | TODO |\n`
}
writeFileSync(join(outDir, 'INDEX.md'), md)
console.log(`INDEX.md  (${rows.length} modules)`)
