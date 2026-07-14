#!/usr/bin/env node
/**
 * tasklog-gotcha.mjs — PreToolUse hook (Edit|Write|MultiEdit)
 * AI ไม่ต้องจำว่าต้อง lookup INDEX — hook ทำแทนแบบ deterministic:
 *   1. อ่าน file_path ที่กำลังจะแก้ → map เป็น module key (regex เดียวกับ migrate.mjs)
 *   2. เปิด task-log/INDEX.md หาแถวของ module นั้น
 *   3. ถ้ามี gotcha/BC → inject เข้า context ผ่าน additionalContext
 *   4. จำ per (session, module) — module เดิมเตือนครั้งเดียวพอ กันสแปม context
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
try { input = readFileSync(0, 'utf8') } catch { ok() }
let data = {}
try { data = JSON.parse(input) } catch { ok() }

const filePath = data?.tool_input?.file_path ?? ''
const cwd = data?.cwd ?? process.cwd()
const sessionId = data?.session_id ?? 'nosession'
if (!filePath) ok()

// --- หา repo root ที่มี task-log/INDEX.md (ไต่ขึ้นจาก cwd) ---
let root = cwd, indexPath = ''
for (let i = 0; i < 6; i++) {
  const p = join(root, 'task-log', 'INDEX.md')
  if (existsSync(p)) { indexPath = p; break }
  const up = dirname(root); if (up === root) break; root = up
}
if (!indexPath) ok()

// --- module key (ให้ตรงกับ migrate.mjs — ปรับ 2 ที่พร้อมกันเสมอ) ---
// strip root prefix แบบ case-insensitive — Windows drive letter อาจมาคนละ case (C:/ vs c:/)
const fpNorm = filePath.replace(/\\/g, '/')
const rootNorm = root.replace(/\\/g, '/') + '/'
const rel = fpNorm.toLowerCase().startsWith(rootNorm.toLowerCase())
  ? fpNorm.slice(rootNorm.length)
  : fpNorm
const moduleOf = p => {
  let m
  if ((m = p.match(/^modules\/([\w-]+)\//))) return m[1]
  if ((m = p.match(/^(?:lib|app\/actions)\/([\w-]+)/))) return `(shim) ${m[1]}`
  if ((m = p.match(/^app\/(?:visit\/)?([\w-]+)\//))) return `page:${m[1]}`
  if ((m = p.match(/^components\/([\w-]+)\//))) return `ui:${m[1]}`
  if ((m = p.match(/^tests\/([\w-]+)\//))) return `test:${m[1]}`
  if ((m = p.match(/^(prisma|hooks|scripts)\//))) return m[1]
  return null
}
const mod = moduleOf(rel)
if (!mod) ok()

// --- กันสแปม: module เดิมใน session เดิม inject ครั้งเดียว ---
const stateDir = join(tmpdir(), 'tasklog-gotcha')
mkdirSync(stateDir, { recursive: true })
const stateFile = join(stateDir, `${sessionId}.json`)
let seen = {}
try { seen = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* fresh */ }
if (seen[mod]) ok()

// --- lookup แถวใน INDEX ---
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
  `[task-log] กำลังแก้ module "${mod}" — ประวัติที่ต้องรู้ก่อนแตะ:`,
  hasBC ? `- Bug classes: ${bc} (รายละเอียดใน CLAUDE.md)` : null,
  hasGotcha ? `- Gotcha: ${gotcha}` : null,
  `- Entries ที่เกี่ยว (เปิดเฉพาะที่จำเป็น อย่าอ่าน shard ทั้งไฟล์): ${entries}`,
].filter(Boolean).join('\n')
ok(msg)
