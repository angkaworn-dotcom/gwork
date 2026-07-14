#!/usr/bin/env node
/**
 * migrate.mjs — แตก `update task.md` (append-only log) เป็น:
 *   task-log/YYYY-MM.md   (shard รายเดือน, entry เดิมทุกตัว + anchor id คงที่)
 *   task-log/INDEX.md     (dict: module → entries → BC → gotcha 1 บรรทัด [ให้เติมมือ])
 * ไม่แก้ไฟล์ต้นฉบับ — เขียนผลลัพธ์ลง task-log/ เท่านั้น
 * Usage: node migrate.mjs "update task.md"
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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
// dedupe ids (same date, no seq, multiple entries) → append -b, -c ...
const seen = new Map()
for (const e of entries) {
  const n = (seen.get(e.id) ?? 0) + 1
  seen.set(e.id, n)
  if (n > 1) e.id = `${e.id}-${String.fromCharCode(95 + n)}` // ตัวที่ 2 → -a, ตัวที่ 3 → -b, ...
}

// --- 3. extract touched modules/paths per entry ---
const PATH_RE = /(?:modules|app|lib|components|prisma|tests|hooks|scripts)\/[\w\-./[\]]+\.(?:tsx?|mjs|prisma|json|md)/g
const moduleOf = p => {
  const m = p.match(/^modules\/([\w-]+)\//); if (m) return m[1]
  const shim = p.match(/^(?:lib|app\/actions)\/([\w-]+)/); if (shim) return `(shim) ${shim[1]}`
  const page = p.match(/^app\/(?:visit\/)?([\w-]+)\//); if (page) return `page:${page[1]}`
  const comp = p.match(/^components\/([\w-]+)\//); if (comp) return `ui:${comp[1]}`
  const test = p.match(/^tests\/([\w-]+)\//); if (test) return `test:${test[1]}`
  const area = p.match(/^(prisma|hooks|scripts)\//); return area ? area[1] : 'other'
}
for (const e of entries) {
  const text = e.body.join('\n')
  e.paths = [...new Set(text.match(PATH_RE) ?? [])]
  e.modules = [...new Set(e.paths.map(moduleOf))]
  if (e.modules.length === 0) e.modules = ['misc']  // entry ไม่มี path → เข้าแถว misc กัน INDEX ตกหล่น
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
  list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) // numeric กัน -10 มาก่อน -2
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
let md = `# task-log INDEX (dict — lookup ก่อนแตะ module ห้ามอ่าน shard ทั้งไฟล์)

> วิธีใช้: หา module ที่กำลังจะแตะ → เปิดเฉพาะ entry ที่ชี้ (\`task-log/YYYY-MM.md#anchor\`)
> กฎบวม: gotcha ต่อแถว ≤ 1 บรรทัด · module ที่ gotcha ซ้ำ ≥2 ครั้ง หรือ destructive 1 ครั้ง → promote เป็น BC ใน CLAUDE.md แล้วเหลือแค่เลข BC ที่นี่
> คอลัมน์ gotcha ตอน migrate เป็น TODO — เติมจากความจำ/entry จริงเฉพาะแถวที่มีบทเรียนจริง แถวงานปกติปล่อยว่างได้

| Module | Entries (ล่าสุดก่อน) | BC | Gotcha (≤1 บรรทัด) |
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
