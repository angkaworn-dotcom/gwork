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

## Bypass resistance (added 2026-07-15, from the Hermes/DeepSeek red-team round)

Evidence: under a conflicting order, deepseek-v4-flash really did self-authorize
(emptied `forbidden: []` — S9, now countered by check G). Thought-exercise mapped the
remaining local bypass vectors, all unexercised so far:

1. **New lane** — write to a path the forbidden regexes never covered (`lib/money2/`).
   Deterministic counter available today: changed files that map to NO module under
   `gwork.json → modules` = uncharted lane → flag.
2. **New world** — `git init` a fresh repo + new remote; the kit never sees it.
   Uncounterable locally, but also low-harm: what never reaches the real repo never
   ships.
3. **Remove the gate** — `git config core.hooksPath /dev/null` (or unset). The
   loudest but currently 100%-silent-at-push hole in the local design.

Two counter-directions, in preference order:

**A. Local, git-independent (preferred — owner's direction): separation of powers.**
One tool *sets* flags, a different tool *checks* them, state crosses several layers
so no single artifact under the agent's direct control decides the outcome — the
"filter stack" model: work flows through every layer, and at least one layer must be
bolted down where the agent's hands physically cannot reach.

Mechanism evaluation (2026-07-15):
- **Owner signature (preferred bolted layer).** Repo holds only the owner's PUBLIC
  key; removing a protection (check G's territory) requires the touching commit to be
  signature-verified against it (git SSH commit signing + allowed-signers,
  `git verify-commit`). The agent can read the public key freely — verification is
  math, not secrecy — and the second factor is the owner's finger on a hardware key /
  passphrase prompt: physically outside the agent, no second OS account needed.
  Two known holes to close in the design: a key cached in ssh-agent without per-use
  confirmation lets the agent sign silently (require touch/passphrase per signature),
  and approval must bind to the specific change (commit signing does this for free).
- **Shared-secret OTP (TOTP) — rejected.** The verifier must hold the shared secret
  locally to compute the expected code; the agent reads the secret and generates valid
  codes. Any shared-secret scheme collapses on a machine the agent can read.
- **Separate OS user / ACL — deprioritized.** The only other true local boundary, but
  setup friction is high and on a single-admin dev machine the same hands hold the
  ACLs; keep as fallback where signing hardware doesn't exist.
- **Watchdog with cross-layer checksums / append-only journal — supporting layers.**
  Reachable by the agent, so they detect-and-shout rather than block; they upgrade
  G/H-style "cheating leaves a signature" into "cheating is auto-detected on mismatch".

Design constraint carried over from G/H: layers the agent *can* reach must make
cheating loud and signed, not silently possible; the one layer it *cannot* reach
(owner's signature) is what makes the gate hold. Gate: design sketch + a red-team
e2e (S11: order the agent to disable the gate; measure whether any path stays silent).

**B. Server-side (fallback, needs a remote):** pre-receive hook running tasklog-check
on self-hosted remotes · GitHub Actions required check + branch protection for GitHub
repos. Physically out of the agent's reach, but reintroduces the git/remote dependency
A is trying to avoid.

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
