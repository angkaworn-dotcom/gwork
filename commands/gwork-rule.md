---
description: เพิ่ม/แก้กฎ gwork — จำแนกให้เองว่ากฎลงช่องไหน (gwork.json / hook / CLAUDE.md)
---

เพิ่มหรือแก้กฎตามที่ user บอก โดยเดินตาม decision tree ของ gwork:

**ขั้นแรก จำแนก:** กฎนี้เช็คได้แบบ deterministic ไหม (เครื่องตัดสิน ไม่ต้องใช้ดุลพินิจ)?

**ถ้าใช่ — ลงระบบ เรียงตามช่องทาง:**
1. เกี่ยวกับ commit message → แก้ `gwork.json` → `commit.types`
2. เป็น check ที่รันได้ก่อน push (command ที่ fail = ห้าม push) → เพิ่มเข้า `gwork.json` → `prepush`
3. เกณฑ์ความสะอาด task-log → `gwork.json` → `tasklog.maxGotcha` / `bcGotchaMax`
4. การ map ไฟล์เป็น module → `gwork.json` → `modules` (regex ใน JSON ต้อง `\\w`)
5. เกินขอบเขต config (กฎตรวจ INDEX แบบใหม่, log format) → แก้โค้ด `scripts/tasklog-check.mjs` / `migrate.mjs` ตาม pattern เดิม
- ไม่มี `gwork.json` ใน repo → copy จาก `~/.claude/skills/gwork/gwork.example.json` ก่อนแล้วค่อยแก้ (ลบ key ที่ไม่ได้เปลี่ยนออก เหลือเฉพาะที่ต่างจาก default)

**ถ้าไม่ — ลง CLAUDE.md แบบประหยัดที่สุด:**
- ก่อนเพิ่ม ถามซ้ำว่าบีบเป็น check ได้จริงๆ ไหม (กฎจำนวนมากที่ดูเป็นดุลพินิจ มีเวอร์ชัน deterministic ซ่อนอยู่) — ถ้าได้ เสนอทางนั้นก่อน
- ถ้าเป็นบทเรียนจาก module ใดเฉพาะ → ลงคอลัมน์ Gotcha ใน INDEX แทน (hook จะฉีดให้เอง) ไม่ใช่ CLAUDE.md
- ลง CLAUDE.md เฉพาะกฎดุลพินิจล้วน เขียน ≤2 บรรทัด

**ปิดท้ายทุกครั้ง:** ทดสอบกฎใหม่ให้เห็นจริง (ลอง commit/push/แตะไฟล์ที่ควรโดน + ที่ไม่ควรโดน) แล้วรายงานผล — อย่า commit เอง

กฎที่ต้องการ: $ARGUMENTS
