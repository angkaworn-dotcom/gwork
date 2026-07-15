# ROADMAP — platform vision, gated by evidence

gwork's positioning: **Workflow-as-Code for AI engineering** — rules, events, plugins,
and adapters that control AI coding agents, not tied to any single AI or to Git.

This document records the long-term vision (20 items, proposed 2026-07-14) **without
building any of it yet**. gwork's own core principle applies to its roadmap:

> **An item gets built only when real-usage evidence shows the problem it solves
> actually occurs.** No feature is built from imagination. Each item below carries an
> explicit evidence gate; until the gate is met, the item stays here.

The bottleneck for almost every gate is the same: **gwork has not yet run in a real
repo for a sustained period.** Step zero is installing the kit into a real project and
using it for 1–2 weeks.

Legend: ⭐ = flagged highest-value by the original proposal.

## Near-term (deterministic, fits current philosophy)

| # | Item | What it is | Evidence gate |
|---|------|-----------|---------------|
| 8 | **Architecture Guard** ⭐ | Block wrong-layer imports (e.g. UI → DB) via static check in prepush / PreToolUse | Best next feature. Gate: a real repo with a layer convention to protect — first real install. |
| 9 | Auto Test Policy | On finish, run only tests mapped to the touched module (`Visit → visit.test.ts`) | A real repo where full-suite runs are demonstrably too slow per task. |
| 3 | Rule Engine ⭐ | Declarative rules (`when` / `require` / `inject`) instead of editing JS | `gwork.json` **is** the small rule engine — grow it key-by-key (as `forbidden` was added from S7 evidence). Jump to a YAML DSL only if config keys demonstrably stop scaling. |

## Already covered (fully or partly) by the current stack

| # | Item | Status |
|---|------|--------|
| 2 | Event Driven (TaskStart/BeforeEdit/…/Finish) | Claude Code hooks are that event system: PreToolUse = BeforeEdit, PostToolUse = AfterEdit, Stop = Finish. The genuinely new part is "other AIs too" → see #1/#18. |
| 11 | Session Memory (resume what was done / pending) | Task-log + INDEX + handoff flows already serve this; Claude Code has native memory. Revisit only if a concrete resume failure occurs that these don't cover. |

## Right principle, wrong time (needs a second consumer or real measurements)

| # | Item | Evidence gate |
|---|------|---------------|
| 1 | Core / Adapter split ⭐ | **Gate met 2026-07-15 — first second consumer shipped: Hermes Agent** (`hermes/` — pre_tool_call hook adapter + 5 SKILL.md skills, e2e S10 3/3). The friction found in practice: only stdin field names, tool names, and output shape differ; the core needed zero changes. No further abstraction until a *third* consumer shows what varies. |
| 18 | LLM Agnostic ⭐ | Same gate as #1 — they are the same work item. Hermes adapter is the first data point. |
| 5 | Dependency Graph (edit Visit → inject Customer/Project too) ⭐ | A real case where module-scoped injection missed a needed dependency and caused a mistake. |
| 6 | Context Ranking (score gotchas/docs, inject top-N) | Measurements from real usage showing current injection is too big or misses the important item. Don't optimize what has never been measured. |
| 10 | Prompt Builder (generate per-task context instead of one big CLAUDE.md) | Same measurement gate as #6; CLAUDE.template.md staying short is the current mitigation. |
| 4 | Plugin System (tasklog / architecture / security / … toggleable) | At least 3 rule families that real users want to enable independently. `gwork.json → modules` is the seed. |
| 12 | Task State Machine (Draft→Planning→Coding→Testing→Review→Done) | Real usage showing per-state rules are needed beyond the current log-on-finish discipline. |
| 15 | Project Templates (`gwork init nextjs` …) | Multiple real installs whose setup steps turn out repetitive. |

## Ecosystem / far horizon (let others do it, or revisit much later)

| # | Item | Note |
|---|------|------|
| 7 | Knowledge Base + semantic search | Task-log + grep is the deterministic answer today; semantic search is ecosystem territory. |
| 13 | Metrics Dashboard | Needs data that only real usage produces. |
| 14 | Multi-Agent roles (Planner→Coder→Reviewer→Tester) | Platform feature; gwork should stay the shared rule layer under whatever orchestrates. |
| 16 | Visual Workflow (BPMN-style in browser) | Far beyond evidence. |
| 17 | IDE Integration (VSCode/Cursor/Windsurf share one rule set) | Follows from #1/#18 if that ever happens. |
| 19 | AI Personas | Prompting concern, not enforcement — out of scope for the kit. |
| 20 | Marketplace (`gwork install clean-architecture`) | Requires #4 plus external users. |

## Actual priority order

1. **Install the kit into a real repo and use it 1–2 weeks** (Osaki Hub Evo when its
   up-to-date repo is available) — the bottleneck for every gate above.
2. `gate: pre-commit` option in `gwork.json` (repos with no remote never fire pre-push).
3. **Architecture Guard (#8)** — first new feature, once there is a real layer
   convention to protect.
4. Everything else waits for its gate.

Original proposal's Phase 1 (Core/Adapter, Event System, Rule Engine, Plugin System,
Dependency Graph) is deliberately **not** the build order: platform-first before a
second user is the classic recipe for a wrongly-designed abstraction — the exact trap
gwork exists to prevent.
