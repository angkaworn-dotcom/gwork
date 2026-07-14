#!/usr/bin/env node
/**
 * tasklog-check.mjs — ตัวบังคับกฎ task-log แบบ deterministic (ใช้ใน pre-push + CI)
 * exit 1 พร้อมรายการที่พัง เมื่อ:
 *   A. entry ใน shard ไม่ถูกอ้างจาก INDEX เลย  → "ลง log แล้วลืม update INDEX"
 *   B. INDEX ชี้ anchor ที่ไม่มีจริงใน shard     → link เน่า (rename/ลบแล้วไม่ตาม)
 *   C. คอลัมน์ Gotcha ยาวเกิน MAX_GOTCHA ตัวอักษร → ฝืนกฎ ≤1 บรรทัด
 *   D. แถวที่มี BC แล้ว แต่ยังมี gotcha text ยาว   → ต้อง promote แล้วตัด text (กัน INDEX บวม)
 * Usage: node scripts/tasklog-check.mjs [--dir task-log]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dirArg = process.argv.indexOf('--dir')
const DIR = dirArg > -1 ? process.argv[dirArg + 1] : 'task-log'
// เกณฑ์ปรับได้ที่ gwork.json → tasklog.maxGotcha / tasklog.bcGotchaMax
// ไม่มีไฟล์ = default · มีแต่ parse ไม่ได้ = fail ดังๆ (config เสียห้ามเงียบ)
let cfg = {}
if (existsSync('gwork.json')) {
  try { cfg = JSON.parse(readFileSync('gwork.json', 'utf8')) }
  catch (e) { console.error(`tasklog-check: gwork.json parse ไม่ได้ — ${e.message}`); process.exit(1) }
}
const MAX_GOTCHA = cfg.tasklog?.maxGotcha ?? 140
const BC_GOTCHA_MAX = cfg.tasklog?.bcGotchaMax ?? 80
const errors = []

if (!existsSync(join(DIR, 'INDEX.md'))) {
  console.error(`tasklog-check: ไม่พบ ${DIR}/INDEX.md`); process.exit(1)
}

// --- รวม anchor ทั้งหมดจาก shards ---
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

  // B: ทุก link ต้องชี้ anchor จริง
  for (const m of entries.matchAll(/\[([^\]]+)\]\(([^)]+)#([^)]+)\)/g)) {
    referenced.add(m[3])
    if (!shardAnchors.has(m[3]))
      errors.push(`B ${mod}: link "${m[1]}" ชี้ anchor #${m[3]} ที่ไม่มีใน shard`)
    else if (!m[2].endsWith('/' + shardAnchors.get(m[3])) && m[2] !== shardAnchors.get(m[3]))
      errors.push(`B ${mod}: link "${m[1]}" ชี้ไฟล์ ${m[2]} แต่ anchor #${m[3]} อยู่ใน ${shardAnchors.get(m[3])}`)
  }
  // C: gotcha 1 บรรทัด
  if (gotcha && gotcha !== 'TODO' && gotcha.length > MAX_GOTCHA)
    errors.push(`C ${mod}: gotcha ${gotcha.length} chars (max ${MAX_GOTCHA}) — กลั่นให้เหลือบรรทัดเดียว หรือ promote เป็น BC`)
  // D: มี BC แล้วต้องไม่แบก gotcha ยาวซ้ำ
  if (bc && bc !== '—' && gotcha && gotcha !== 'TODO' && gotcha.length > BC_GOTCHA_MAX)
    errors.push(`D ${mod}: มี ${bc} แล้ว — ย้ายรายละเอียดเข้า BC ใน CLAUDE.md แล้วตัด gotcha ที่นี่ให้สั้น`)
}

// --- A: entry ของเดือนล่าสุดต้องถูกอ้างครบ (เดือนเก่า grandfather — INDEX cap refs ได้) ---
const months = [...new Set([...shardAnchors.values()])].sort()
const latest = months[months.length - 1]
for (const [id, f] of shardAnchors) {
  if (f === latest && !referenced.has(id))
    errors.push(`A ${f}#${id}: entry เดือนล่าสุดไม่ถูกอ้างจาก INDEX — เพิ่ม ref ในแถว module ที่แตะ`)
}

if (errors.length) {
  console.error(`tasklog-check FAILED (${errors.length}):\n` + errors.map(e => '  ' + e).join('\n'))
  process.exit(1)
}
console.log(`tasklog-check OK — ${shardAnchors.size} entries, INDEX ครบ`)
