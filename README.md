# gwork — discipline kit for AI coding agents

Deterministic rules enforced by git hooks and Claude Code hooks, not prompts. **Blocked push > polite reminder.**

หลักการเดียว: **กฎไหน check ได้แบบ deterministic → เป็น hook/script ที่ block จริง** CLAUDE.md เหลือเฉพาะเรื่องดุลพินิจ

## อะไรคุมด้วยอะไร

| กฎ | คุมด้วย | ผลถ้าฝืน |
|---|---|---|
| tsc ผ่านก่อน push | `githooks/pre-push` | push ไม่ออก |
| commit format `type: desc` ห้าม `@` (ยกเว้น Merge/Revert) | `githooks/commit-msg` | commit ไม่ผ่าน |
| ลง log แล้วต้อง update INDEX (เดือนล่าสุด) | `scripts/tasklog-check.mjs` ใน pre-push | push ไม่ออก |
| INDEX link เน่า/ชี้ผิด shard · gotcha ยาวเกิน · มี BC แล้วยังแบก text | tasklog-check | push ไม่ออก |
| อ่าน gotcha ก่อนแตะ module | `hooks/tasklog-gotcha.mjs` (PreToolUse) | inject ให้เอง — AI ไม่ต้องจำ |
| Evidence / Confidence gate / Clarify Early / subagent ห้าม commit | `CLAUDE.template.md` (prompt) | ดุลพินิจ — automate ไม่ได้ |

## ใช้เป็น Claude Code skill

```bash
git clone https://github.com/angkaworn-dotcom/gwork.git ~/.claude/skills/gwork
```

แล้วสั่งใน Claude Code ว่า **"ติดตั้ง gwork"** ใน repo เป้าหมาย — ขั้นตอนเต็มอยู่ใน [SKILL.md](SKILL.md) จุดที่ต้องปรับต่อ project (module regex, pre-push command, log format) อยู่ใน [ADAPT.md](ADAPT.md)

## ติดตั้งมือ (ไม่ใช้ skill)

```bash
# 1. copy โครง
cp -r githooks <repo>/githooks
cp scripts/tasklog-check.mjs scripts/migrate.mjs <repo>/scripts/
cd <repo> && git config core.hooksPath githooks

# 2. มี log เดิม → migrate (ปรับ PATH_RE + moduleOf ใน scripts/migrate.mjs ก่อน — ดู ADAPT.md)
node scripts/migrate.mjs "update task.md"
# ไม่มี → สร้าง task-log/INDEX.md (header ตาราง) + task-log/<YYYY-MM>.md เปล่า

# 3. hook ฉีด gotcha (ครั้งเดียวต่อเครื่อง)
cp hooks/tasklog-gotcha.mjs ~/.claude/hooks/
# แล้วลงทะเบียน PreToolUse ใน ~/.claude/settings.json:
```
```json
"hooks": { "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit",
  "hooks": [{ "type": "command", "command": "node \"<ABS>/.claude/hooks/tasklog-gotcha.mjs\"" }] } ] }
```

## จุดที่ต้อง sync กันเสมอ

`moduleOf()` มี 2 สำเนา — `scripts/migrate.mjs` และ `hooks/tasklog-gotcha.mjs` **แก้ regex ต้องแก้คู่กัน** (จงใจไม่ dedupe: hook อยู่ global `~/.claude/` script อยู่ใน repo)

## ผลทดสอบกับข้อมูลจริง (Osaki Hub Evo, 2026-07)

- migrate: 193 entries → 3 shards + INDEX 137 modules · tasklog-check เขียว
- hook: inject BC+entries ตอนแตะ module ครั้งแรก · ครั้งที่สองเงียบ · ไฟล์นอก module เงียบ
- ผ่านการไล่บัค 2026-07-14: merge/revert commit ผ่าน hook, path case-insensitive บน Windows, จับ link ชี้ผิด shard, เรียง seq ≥10 ถูกลำดับ

## Phase 2 (รอหลักฐานจากการใช้จริงก่อนตัดสิน)

- PreToolUse block `git commit` ใน subagent context
- Stop hook เตือนเมื่อจบ turn ที่แก้โค้ดแล้วยังไม่ลง task-log (ตอนนี้กันที่ pre-push ชั้นเดียว)
