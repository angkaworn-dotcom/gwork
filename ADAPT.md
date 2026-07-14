# ปรับกฎให้ตรง repo — แก้ที่ `gwork.json` ไฟล์เดียว

วาง `gwork.json` ที่ root ของ repo (copy จาก [gwork.example.json](gwork.example.json)) — **ไม่ต้องแตะโค้ด hook/script เลย**
กติกา: ไม่มีไฟล์ / ไม่มี key ไหน = ใช้ default · มีไฟล์แต่ parse ไม่ได้ = ทุกด่าน **fail ดังๆ** (commit/push ไม่ออกจนกว่าจะแก้ config)

## key ทั้งหมด

### `commit.types` — type list ของ commit message
```json
"commit": { "types": ["feat", "fix", "chore", "wip"] }
```
ข้อความที่ git สร้างเอง (`Merge`/`Revert`/`fixup!`/`squash!`) ผ่านเสมอ ไม่ต้องใส่

### `prepush` — รายการ check ก่อน push (รันตามลำดับ ตัวไหน fail = push ไม่ออก)
```json
"prepush": ["npx tsc --noEmit", "node scripts/tasklog-check.mjs", "npm run test:run"]
```
repo ไม่ใช่ TypeScript ก็เปลี่ยนเป็น build/lint ของ stack นั้นได้เลย

### `tasklog` — เกณฑ์ความสะอาดของ INDEX
```json
"tasklog": { "maxGotcha": 140, "bcGotchaMax": 80 }
```
`maxGotcha` = ความยาวสูงสุดของคอลัมน์ Gotcha · `bcGotchaMax` = เพดานเมื่อแถวมี BC แล้ว (ต้อง promote แล้วตัด text)

### `modules` — กติกา map path → module key (ใช้ร่วมกันทั้ง migrate และ gotcha hook)
```json
"modules": [
  { "pattern": "^src/([\\w-]+)/", "name": "svc:$1" },
  { "pattern": "^packages/([\\w-]+)/", "name": "pkg:$1" }
]
```
- เรียงลำดับสำคัญ — ตัวแรกที่ match ชนะ
- `$1`..`$9` อ้าง capture group · regex ใน JSON ต้อง escape backslash เป็น `\\w`
- path ที่ไม่ match: migrate → แถว `other`/`misc` · gotcha hook → เงียบ (ครอบคลุมโฟลเดอร์ที่มี gotcha จริงให้ครบ)
- นี่คือชุดเดียวที่ทั้ง `scripts/migrate.mjs` และ `hooks/tasklog-gotcha.mjs` อ่าน — ไม่มีปัญหา 2 สำเนาอีกแล้ว

### `pathPattern` — regex จับ path ในเนื้อ log entry (ใช้ตอน migrate)
แก้ prefix list และนามสกุลไฟล์ให้ตรง stack (เช่น Svelte เพิ่ม `svelte`, PHP เพิ่ม `php`)

## สิ่งที่ยังต้องแก้ในโค้ด (config ไม่ครอบคลุม)

- **รูปแบบ header ของ log เดิม** ที่ `migrate.mjs` อ่าน: ต้องเป็น `## YYYY-MM-DD` (ตามด้วย `(n)` / `— title` ได้) — log format อื่นให้แก้ regex ใน migrate.mjs หรือแปลง header ก่อน
- **เพิ่มกฎตรวจ INDEX แบบใหม่** (นอกเหนือ A/B/C/D): เขียนเพิ่มใน `scripts/tasklog-check.mjs` ตาม pattern `errors.push(...)`
