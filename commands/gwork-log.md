---
description: ปิดงาน — ลง task-log entry + update INDEX ในคอมมิตเดียว
---

ปิดงานที่เพิ่งทำเสร็จลง task-log ตามกติกา gwork:

1. ดูจาก git diff/log ว่างานรอบนี้แตะไฟล์อะไร แก้ปัญหาอะไร commit ไหน
2. เขียน entry ต่อท้าย `task-log/<YYYY-MM>.md` (เดือนปัจจุบัน สร้างไฟล์ถ้ายังไม่มี):
   - anchor `<a id="YYYY-MM-DD-n"></a>` — n คือ seq ถ้าวันนั้นมีหลาย entry (ดู id ที่มีอยู่ก่อน อย่าซ้ำ)
   - header `## YYYY-MM-DD — <หัวเรื่องสั้น>`
   - เนื้อหา: ที่มา/ปัญหา · ไฟล์ที่แก้ · commit hash · Decision (ถ้ามี) · Gotcha (ถ้ามี) · Validation ที่ทำจริง · **ผลกระทบงานก่อนหน้า** (ไม่มี = เขียนว่าไม่มี)
3. Update แถว INDEX (`task-log/INDEX.md`) ของ**ทุก module ที่แตะ** — เพิ่ม link entry ใหม่ไว้หน้าสุดของคอลัมน์ Entries · module ใหม่ = เพิ่มแถว · ถ้ามีบทเรียนจริงให้เติมคอลัมน์ Gotcha ≤1 บรรทัด
4. ถ้า gotcha นี้ซ้ำกับที่เคยเกิด ≥2 ครั้ง หรือเป็นเหตุ destructive → เสนอ promote เป็น BC-xxx ใน CLAUDE.md แล้วลดคอลัมน์ gotcha เหลือเลข BC
5. รัน `node scripts/tasklog-check.mjs` ต้องเขียว แล้ว commit ทั้ง shard + INDEX ในคอมมิตเดียว (`docs: ...`)

ห้ามรวมยอดหลายงานเป็น entry เดียว — งานละ entry

$ARGUMENTS
