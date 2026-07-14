---
description: ดูสถานะระบบ gwork ใน repo ปัจจุบัน — ติดตั้งครบไหม config อะไร active
---

รายงานสถานะ gwork ของ repo ปัจจุบันแบบกระชับ:

1. **ติดตั้งครบไหม:**
   - `git config core.hooksPath` ชี้ `githooks` ไหม · `githooks/pre-push` + `commit-msg` มีไหม
   - `scripts/tasklog-check.mjs` มีไหม · `task-log/INDEX.md` มีไหม
   - `~/.claude/hooks/tasklog-gotcha.mjs` มีไหม + ลงทะเบียน PreToolUse ใน `~/.claude/settings.json` แล้วหรือยัง
2. **Config:** มี `gwork.json` ไหม → parse ได้ไหม → แสดง key ที่ override จาก default (ไม่มีไฟล์ = บอกว่าใช้ default ทั้งหมด)
3. **สุขภาพ task-log:** รัน `node scripts/tasklog-check.mjs` → เขียว/แดง กี่ entries · เดือนล่าสุดลง entry ล่าสุดเมื่อไหร่ (เทียบกับ commit ล่าสุดของ repo — ถ้าโค้ดใหม่กว่า log มาก แปลว่ามีงานยังไม่ได้ปิด)
4. **BC:** นับ BC ใน CLAUDE.md + แถว INDEX ที่มี gotcha ยังไม่ promote ทั้งที่ซ้ำ ≥2

สรุปเป็นตาราง ✅/❌ สั้นๆ + ข้อแนะนำเฉพาะจุดที่ขาด อย่าแก้อะไรเองใน command นี้ — รายงานอย่างเดียว

$ARGUMENTS
