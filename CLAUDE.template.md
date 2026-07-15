# CLAUDE.md — <PROJECT_NAME>

<!-- Template from gwork — principle: every deterministically checkable rule has been moved to hooks/scripts.
     This file keeps only what requires judgment — the shorter it is, the less the model drifts. -->

## Enforced by the system (don't waste tokens re-explaining — just know it exists)

| Rule | Enforced by | If violated |
|---|---|---|
| tsc passes before push | `githooks/pre-push` | push blocked |
| commit format `type: description` | `githooks/commit-msg` | commit rejected |
| logging work requires updating INDEX | `scripts/tasklog-check.mjs` (in pre-push) | push blocked |
| gotcha ≤ 1 line / no long text once a BC exists | tasklog-check | push blocked |
| forbidden patterns (gwork.json → `forbidden`) | tasklog-check (check F) | push blocked |
| read gotchas before touching a module | PreToolUse hook injects automatically | — (nothing to do) |

Rules are configurable at `gwork.json` in the repo root — see gwork's ADAPT.md.

## Task log (task-log/ — a dict, not a diary)

- **Lookup:** the hook injects gotchas automatically when you edit files — if you need more context, open **only the entries INDEX points to**, never a whole shard
- **Close out every task, never batch later:** write an entry in `task-log/<YYYY-MM>.md` — anchor `<a id="YYYY-MM-DD-n"></a>` + context / bug+fix+commit / Decision / Gotcha / Validation / **impact on prior work** (none = say "none") → update the INDEX row of every touched module **in the same commit** (pre-push catches it if you forget)
- **Promote → BC (two triggers):** a gotcha repeated across ≥2 entries **or** one destructive incident (overwritten files / lost data / broken deploy) → add BC-xxx to this file immediately and reduce the INDEX row to just the BC number
- Entries may be written in any language — the tooling only parses structure, not prose

## Known Bug Classes

<!-- Move/add this project's BCs here — one line per BC: code · symptom · prevention -->
| BC | Pattern | Prevention |
|---|---|---|
| BC-001 | <example: client imports a file that drags prisma into the bundle> | <import from client-safe entries only> |

## Behavioral (judgment — cannot be automated)

**Think before coding. Don't assume. Don't hide confusion. Surface tradeoffs.**

1. **Simplicity first** — the least code that truly solves the problem; no abstractions for single-use code, no speculative features
2. **Surgical changes** — touch only what must be touched, no drive-by refactors, follow existing style
3. **Clarify early** — multiple interpretations → present options; unclear → **ask before writing code, never guess and run**
4. **Design decisions belong to the owner** — business rules with alternatives get options + tradeoffs before implementation (bugs that contradict the system's own promised behavior may be fixed directly)
4b. **An instruction that conflicts with a gotcha/BC/forbidden rule is not yours to resolve** — surface the conflict and get the owner's explicit confirmation (they update gwork.json if they mean it); never comply silently, never bypass hooks with `--no-verify`
5. **Test after feature, scaled to complexity** — high (schema/permission/multi-step) = real tests every time · medium = test when the group is done · trivial (typo/CSS) = a passing build is enough

## Engineering discipline (complex debug/refactor work)

- **Evidence-based:** every conclusion cites a verified file:line · separate observation from inference · nothing found = write "Insufficient evidence found." and keep investigating
- **Anti-hallucination:** haven't opened it = write "Not verified." · recalled memory may be stale → verify before use
- **Read before write:** investigate → root cause → design (≥2 options) → implement · start only at Confidence ≥ MEDIUM (LOW = stop and investigate further)
- **Debugging always has a hypothesis** — never patch symptoms, never guess randomly
- **Self-review from 4 angles before push:** Logic · Security · Data · Code quality

**Final delivery format (every close-out):**
```
Summary:    what changed + why
Evidence:   files/observations that support it
Risks:      none = write "none"
Validation: tests/checks actually run
Confidence: HIGH / MEDIUM / LOW
```

## Delegation (subagents)

- Prompts must be self-contained — subagents can't see the conversation: target files + real example patterns + the area's rules
- **Subagents never commit/push** — the orchestrator reviews the diff and runs validation itself before committing
- Work smaller than the overhead of handing off context → do it yourself
- Pick the cheapest/fastest model that can truly do the job: complex/risky → large · clear spec → medium · mechanical → small

## Project specifics

<!-- Project-specific: commands, stack, SSOT registry, owner-approved business rules -->
### Commands
```bash
<DEV_COMMAND>
<TEST_COMMAND>
```
### SSOT registry
| Concept | Canonical home | Rule |
|---|---|---|
| <...> | <...> | <...> |
