---
name: gwork
description: Install the gwork discipline kit (git pre-push/commit-msg hooks, task-log INDEX checker, PreToolUse gotcha-injection hook, short CLAUDE.md template) into any git repository. Use when user says "ติดตั้ง gwork", "ลง gwork", "install gwork", "setup discipline kit", "ติดตั้ง project-kit", or wants deterministic enforcement of tsc/commit-format/task-log rules instead of prompt-based rules.
---

# project-kit — discipline ที่คุมด้วยระบบ ไม่พึ่งวินัย AI

หลักการเดียว: **กฎไหน check ได้แบบ deterministic → เป็น hook/script ที่ block จริง** CLAUDE.md เหลือเฉพาะเรื่องดุลพินิจ

ไฟล์ต้นฉบับทั้งหมดอยู่ในโฟลเดอร์สกิลนี้ (`scripts/`, `githooks/`, `hooks/`, `CLAUDE.template.md`)

## อะไรคุมด้วยอะไร

| กฎ | คุมด้วย | ผลถ้าฝืน |
|---|---|---|
| tsc ผ่านก่อน push | `githooks/pre-push` | push ไม่ออก |
| commit format `type: desc` ห้าม `@` | `githooks/commit-msg` | commit ไม่ผ่าน |
| ลง log แล้วต้อง update INDEX (เดือนล่าสุด) | `scripts/tasklog-check.mjs` ใน pre-push | push ไม่ออก |
| INDEX link เน่า / gotcha >140 chars / มี BC แล้วยังแบก text | tasklog-check | push ไม่ออก |
| อ่าน gotcha ก่อนแตะ module | `hooks/tasklog-gotcha.mjs` (PreToolUse) | inject ให้เอง |
| Evidence / Confidence gate / Clarify Early / subagent ห้าม commit | CLAUDE.md (prompt) | ดุลพินิจ |

## ขั้นตอนติดตั้งเข้า repo เป้าหมาย

ให้ `<SKILL>` = โฟลเดอร์สกิลนี้, `<REPO>` = repo เป้าหมาย

1. **สร้าง `gwork.json` ที่ root ของ repo ให้ตรง structure ก่อน** — copy จาก `gwork.example.json` แล้วแก้ตาม [ADAPT.md](ADAPT.md)
   กฎทั้งหมด (commit types, prepush checks, เกณฑ์ gotcha, module mapping) แก้ที่ไฟล์นี้ไฟล์เดียว user แก้ได้อิสระโดยไม่แตะโค้ด · ไม่มีไฟล์ = default (โครง Osaki Hub Evo) · config เสีย = ทุกด่าน fail ดังๆ
2. **Copy โครง:**
   ```bash
   cp -r <SKILL>/githooks <REPO>/githooks
   cp <SKILL>/scripts/tasklog-check.mjs <SKILL>/scripts/migrate.mjs <REPO>/scripts/
   cd <REPO> && git config core.hooksPath githooks
   ```
   ถ้า repo ไม่ใช้ tsc/npx ให้แก้ `githooks/pre-push` ให้เรียก build/check ที่ repo ใช้จริง
3. **task-log:**
   - มี log เดิม (format `## YYYY-MM-DD — title`): `node scripts/migrate.mjs "<log file>"` → ได้ `task-log/` (ไม่แตะไฟล์ต้นฉบับ)
   - ไม่มี: สร้าง `task-log/INDEX.md` (header ตารางเปล่า `| Module | Entries (ล่าสุดก่อน) | BC | Gotcha (≤1 บรรทัด) |`) + `task-log/<YYYY-MM>.md` เปล่า
4. **Slash commands (ทำครั้งเดียวต่อเครื่อง):** `cp <SKILL>/commands/*.md ~/.claude/commands/` → ได้ `/gwork-log` `/gwork-check` `/gwork-rule` `/gwork-status`
5. **PreToolUse hook (ทำครั้งเดียวต่อเครื่อง):** copy `hooks/tasklog-gotcha.mjs` → `~/.claude/hooks/` แล้วเพิ่มใน `~/.claude/settings.json` (merge เข้า hooks เดิม อย่าทับ):
   ```json
   "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit",
     "hooks": [{ "type": "command", "command": "node \"C:/Users/<USER>/.claude/hooks/tasklog-gotcha.mjs\"" }] } ]
   ```
   hook หา `task-log/INDEX.md` เองโดยไต่จาก cwd — ใช้ร่วมได้ทุก repo ที่ลงคิท
6. **CLAUDE.md:** ใช้ `CLAUDE.template.md` เป็นโครง — เติม `<PROJECT_NAME>`, commands, SSOT ของ repo แล้ว**ย้าย gotcha ยาวๆ ใน CLAUDE.md เดิมเข้า Known Bug Classes (BC-xxx บรรทัดเดียว)** เก็บ architecture/project specifics เดิมไว้ ตัดเฉพาะกฎที่ hook คุมแล้ว

## ตรวจหลังติดตั้ง

```bash
node scripts/tasklog-check.mjs            # ต้องเขียว
git commit --allow-empty -m "bad"         # ต้องโดน commit-msg block (แล้ว reset)
```
ทดสอบ hook: แก้ไฟล์ใน module ที่มี gotcha ใน INDEX → ต้องเห็น inject ครั้งแรก ครั้งที่สองเงียบ

## ข้อห้าม / ขอบเขต

- **ห้าม** commit/push แทนเจ้าของ repo ระหว่างติดตั้ง — วางไฟล์แล้วให้เจ้าของรีวิว
- Phase 2 (block subagent commit, Stop hook เตือน task-log) **ยังไม่ทำ** — รอหลักฐานจากการใช้จริงก่อน
