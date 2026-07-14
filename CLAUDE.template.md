# CLAUDE.md — <PROJECT_NAME>

<!-- Template จาก project-kit — หลักการ: กฎที่ check ได้แบบ deterministic ถูกย้ายไป hook/script แล้ว
     ไฟล์นี้เหลือเฉพาะสิ่งที่ต้องใช้ดุลพินิจ — ยิ่งสั้น model ยิ่งไม่หลุด -->

## คุมด้วยระบบแล้ว (อย่าเสียโทเคนอธิบายซ้ำ — แค่รู้ว่ามี)

| กฎ | บังคับโดย | ถ้าฝืน |
|---|---|---|
| tsc ผ่านก่อน push | `.githooks/pre-push` | push ไม่ออก |
| commit format `type: description` | `.githooks/commit-msg` | commit ไม่ผ่าน |
| ลง task-log แล้วต้อง update INDEX | `scripts/tasklog-check.mjs` (ใน pre-push) | push ไม่ออก |
| gotcha ≤ 1 บรรทัด / มี BC แล้วห้ามแบก text ยาว | tasklog-check | push ไม่ออก |
| อ่าน gotcha ก่อนแตะ module | PreToolUse hook inject ให้อัตโนมัติ | — (ไม่ต้องทำอะไร) |

## Task log (task-log/ — dict)

- **Lookup:** hook inject gotcha ให้เองตอนแก้ไฟล์ — ถ้าต้องการบริบทเพิ่ม เปิด**เฉพาะ entry ที่ INDEX ชี้** ห้ามอ่าน shard ทั้งไฟล์
- **ปิดงานทุกครั้ง ห้ามรวมยอดทีหลัง:** เขียน entry ลง `task-log/<YYYY-MM>.md` — anchor `<a id="YYYY-MM-DD-n"></a>` + ที่มา / บั๊ก+แก้+commit / Decision / Gotcha / Validation / **ผลกระทบงานก่อนหน้า** (ไม่มี = เขียนว่าไม่มี) → update แถว INDEX ของทุก module ที่แตะ **ในคอมมิตเดียวกัน** (pre-push จับถ้าลืม)
- **Promote → BC (2 แกน):** gotcha ซ้ำ ≥2 entries **หรือ** destructive ครั้งเดียว (ทับไฟล์/ข้อมูลหาย/deploy พัง) → เพิ่ม BC-xxx ในไฟล์นี้ทันที แล้วแถว INDEX เหลือแค่เลข BC

## Known Bug Classes

<!-- ย้าย/เพิ่ม BC ของ project นี้ตรงนี้ — 1 บรรทัดต่อ BC: รหัส · อาการ · กันยังไง -->
| BC | Pattern | กันยังไง |
|---|---|---|
| BC-001 | <ตัวอย่าง: client import ไฟล์ที่ลาก prisma เข้า bundle> | <import จาก client-safe entry เท่านั้น> |

## Behavioral (ดุลพินิจ — automate ไม่ได้)

**Think before coding. Don't assume. Don't hide confusion. Surface tradeoffs.**

1. **Simplicity First** — โค้ดน้อยสุดที่แก้ปัญหาได้จริง ไม่มี abstraction ให้โค้ด single-use ไม่มี speculative feature
2. **Surgical Changes** — แตะเฉพาะที่ต้องแตะ ไม่ refactor ข้างเคียง ตาม style เดิม
3. **Clarify Early** — ตีความได้หลายทาง → เสนอ option; ไม่ชัด → **ถามก่อนเขียนโค้ด ห้ามเดาแล้วทำ**
4. **Design decision ให้เจ้าของเคาะ** — business rule ที่มีหลายทางเลือก เสนอ option + ข้อดีเสียก่อน implement (bug ที่ขัด behavior ที่ระบบสัญญาไว้เอง แก้ได้เลย)
5. **Test After Feature ตามความซับซ้อน** — ซับซ้อนมาก (schema/permission/multi-step) = test จริงทุกครั้ง · ปานกลาง = test เมื่อเสร็จกลุ่ม · ง่าย (typo/CSS) = build ผ่านพอ

## Engineering Discipline (งาน debug/refactor ซับซ้อน)

- **Evidence-based:** ทุกข้อสรุปอ้าง file:line ที่ verify แล้ว · แยก observation จาก inference · หาไม่เจอ = เขียน "Insufficient evidence found." แล้ว investigate ต่อ
- **Anti-hallucination:** ยังไม่เปิดดู = เขียน "Not verified." · memory recall อาจ stale → verify ก่อนใช้
- **Read-before-write:** investigate → root cause → design (≥2 ทางเลือก) → implement · ลงมือได้เมื่อ Confidence ≥ MEDIUM (LOW = หยุด investigate ต่อ)
- **Debug มี hypothesis เสมอ** — ห้ามแก้ symptom ห้ามสุ่มเดา
- **Self review 4 มุมก่อน push:** Logic · Security · Data · Code Quality

**Final Delivery Format (ปิดงานทุกครั้ง):**
```
Summary:    เปลี่ยนอะไร + ทำไม
Evidence:   ไฟล์/observation ที่ support
Risks:      ไม่มี = เขียน "ไม่มี"
Validation: test/check ที่ทำจริง
Confidence: HIGH / MEDIUM / LOW
```

## Delegation (subagent)

- Prompt ต้อง self-contained — subagent ไม่เห็นบทสนทนา: ไฟล์เป้าหมาย + pattern ตัวอย่างจริง + กฎของ area
- **Subagent ห้าม commit/push** — orchestrator รีวิว diff + รัน validation เองก่อน commit
- งานเล็กกว่า overhead ของการส่ง context → ทำเอง
- เลือก model ถูก/เร็วสุดที่ทำได้จริง: ซับซ้อน/เสี่ยง → ตัวใหญ่ · spec ชัด → กลาง · mechanical → เล็ก

## Project specifics

<!-- ของเฉพาะ project: commands, stack, SSOT registry, business rules ที่เจ้าของเคาะ -->
### Commands
```bash
<DEV_COMMAND>
<TEST_COMMAND>
```
### SSOT Registry
| Concept | Canonical home | กฎ |
|---|---|---|
| <...> | <...> | <...> |
