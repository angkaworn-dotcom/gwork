# ปรับ kit ให้ตรง repo — จุดที่ต้องแก้ต่อ project

## 1. `moduleOf()` — 2 สำเนา แก้คู่กันเสมอ

อยู่ใน `scripts/migrate.mjs` (บรรทัด ~45) และ `hooks/tasklog-gotcha.mjs` (บรรทัด ~43)
ค่า default ผูกกับ structure ของ Osaki Hub Evo:

```js
modules/<X>/          → X            // feature modules
lib/<X>  app/actions/<X> → (shim) X  // shared logic
app/[visit/]<X>/      → page:X       // Next.js pages (มี /visit/ prefix ได้)
components/<X>/       → ui:X
tests/<X>/            → test:X
prisma|hooks|scripts/ → ชื่อ dir ตรงๆ
```

**วิธีปรับ:** สำรวจ top-level dirs ของ repo เป้าหมาย (`ls`) แล้วเขียน regex ให้ทุกโฟลเดอร์โค้ดหลัก map เป็น module key ที่มนุษย์เรียกกันจริง path ที่ไม่ match:
- ใน `migrate.mjs` → ตกแถว `other`/`misc` (ยอมรับได้)
- ใน `tasklog-gotcha.mjs` → return `null` = hook เงียบ (ต้องครอบคลุมโฟลเดอร์ที่มี gotcha จริง)

## 2. `PATH_RE` ใน migrate.mjs (บรรทัด ~44)

Regex จับ path ในเนื้อ log entry — แก้ prefix list (`modules|app|lib|...`) และนามสกุลไฟล์ (`tsx?|mjs|prisma|json|md`) ให้ตรง stack ของ repo (เช่น Svelte เพิ่ม `svelte`, PHP เพิ่ม `php`)

## 3. `githooks/pre-push`

Default: `npx tsc --noEmit` + `node scripts/tasklog-check.mjs`
- repo ไม่มี TypeScript → เปลี่ยนเป็น build/lint command ของ stack นั้น
- อยากเข้ม: เปิดบรรทัด eslint (`npx eslint . --max-warnings 0`) — ช้าขึ้น
- Windows: git for Windows รัน sh hook ได้ตรงๆ ไม่ต้องแปลง

## 4. `githooks/commit-msg`

Type list default: `feat|fix|chore|refactor|docs|test|perf|style|ci` — เพิ่ม/ลดตาม convention ของทีม

## 5. รูปแบบ log เดิมที่ migrate.mjs อ่านได้

Entry header ต้องเป็น `## YYYY-MM-DD` (ตามด้วย `(n)` และ/หรือ `— title` ได้)
ถ้า log เดิมใช้ header แบบอื่น → แก้ regex บรรทัด ~20 หรือแปลง header ก่อน migrate
