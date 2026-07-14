---
description: ตรวจสุขภาพ task-log (INDEX/link/gotcha) แล้วช่วยแก้ถ้าแดง
---

ตรวจความสอดคล้องของ task-log ใน repo ปัจจุบัน:

1. รัน `node scripts/tasklog-check.mjs` (ถ้าไม่มี script ใน repo ให้รันจาก `~/.claude/skills/gwork/scripts/tasklog-check.mjs` แล้วชี้ `--dir task-log`)
2. เขียว → รายงานสั้นๆ ว่ากี่ entries จบ
3. แดง → อธิบายแต่ละ error เป็นภาษาคน แล้วแก้ให้:
   - **A** entry ไม่ถูกอ้างจาก INDEX → เพิ่ม link ในแถว module ที่เกี่ยว (ดูจากเนื้อ entry ว่าแตะไฟล์ไหน)
   - **B** link เน่า/ชี้ผิด shard → แก้ path หรือ anchor ให้ตรงตำแหน่งจริง
   - **C** gotcha ยาวเกิน → กลั่นเหลือบรรทัดเดียว (เก็บใจความ "ระวังอะไร + กันยังไง")
   - **D** มี BC แล้วยังแบก text → ย้ายรายละเอียดเข้า BC ใน CLAUDE.md แล้วเหลือเลข BC ใน INDEX
4. แก้เสร็จรันซ้ำจนเขียว แล้วสรุปว่าแก้อะไรไปบ้าง — อย่า commit เอง ให้ user รีวิวก่อน

$ARGUMENTS
