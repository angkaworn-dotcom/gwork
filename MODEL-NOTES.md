# MODEL-NOTES — why the prompt layer changed, per model generation

Append-only, newest first. **This is not [LESSONS.md](LESSONS.md)** — that one logs bugs in the kit's
deterministic layer (hooks, scripts, install steps). This one logs changes to the *prompt* layer
(`CLAUDE.template.md`, command wording) that were made because a **model generation changed**, not
because anything was broken.

It exists for one reason: prompt-layer lines that get removed are usually removed because a newer
model already does that thing on its own — and every removed line still *looks* like good practice
six months later. Without a record, someone (or some AI) puts it back.

Format: `## M-xxx — <one-line change>` · date · trigger · Removed / Kept / Added / Conditional · Harness.

---

## M-001 — prompt layer trimmed for Opus 5-class models; verification scaffolding made conditional

- **Date:** 2026-07-25 · **Trigger:** Opus 5 becoming the default driver for gwork repos
- **File:** `CLAUDE.template.md` (plus the install choice documented in `ADAPT.md` / `SKILL.md` step 6)
- **Owner-supplied rationale, recorded as cited — not independently verified by the kit** (per the
  template's own "Not verified." rule): FrontierCode showed scope-limiting instructions recovering
  score on this generation; AA-Omniscience showed Opus 5 ~11% more accurate than 4.8 but with a ~6%
  higher hallucination rate. The second figure is the load-bearing one — see *Kept* below.

### Removed

| Line | Why |
|---|---|
| `Self-review from 4 angles before push: Logic · Security · Data · Code quality` | Matches the "add a checking step at the end" pattern that produces over-verification on this generation. The model already reviews its own work; the instruction converts one pass into two and inflates the report. |
| `Final delivery format (every close-out)` — the 5-field Summary/Evidence/Risks/Validation/Confidence block | Forces long output on every close-out, including one-line fixes, and stacks on top of Opus 5 already being more verbose per message by default. Replaced with a length *cap* ("prose, not a form"), which is a cut, not a substitute scaffold. |
| `investigate → root cause → design → implement` (the ordering itself) | Prescribes *how to think*. That is the class of instruction worth removing — a frontier model plans on its own, and a fixed sequence mostly forces visible narration of it. |

### Kept — do not remove these as "more of the same"

- **rule 2, Surgical changes** — this is a *scope limit*, not process. Same family as the instructions
  that recovered FrontierCode score. Its value went up in this refactor, not down.
- **rule 4b, conflicting-instruction escalation** — governance. It defines who may change a protected
  rule and leaves the audit trail (`Gwork-Owner-Approved:` trailer + config diff) that check G reads.
  Not a thinking process, and no model capability makes it unnecessary.
- **Anti-hallucination `"Not verified."`** — the tempting cut, and the wrong one. Better self-verification
  is not the same property as a lower hallucination rate; on the owner's cited numbers this generation
  moved the two in *opposite* directions. Removing this because "the model checks itself now" reasons
  from the accuracy number to the hallucination number.
- **`≥2 options` for design decisions** — survived the removal of the sequence it used to sit inside.
  It is the owner's decision right, not a step in a procedure.

### Added

- **Output discipline** section — conciseness and narration control, stated directly. Reasoning-effort
  settings govern how much the model *thinks*, not how long it *writes*; response length has to be
  instructed separately or it does not move.
- **Delegation → effort dial** — the section previously covered model *size* only. Effort is a second,
  independent dial, and it is **not monotonic on coding tasks**: higher is not reliably better, and on
  well-specified mechanical work it costs latency and invites over-engineering.

### Conditional (the split)

gwork now has two prompt-layer consumers — Claude Code and Hermes/DeepSeek V4 (`hermes/`). Removing
verification scaffolding is right for Opus 5 and **wrong for deepseek-v4-flash**: e2e S9, before checks
G/H existed, had a flash run empty `forbidden: []` on its own and describe that as "the only authorized
override mechanism". A model that still needs the rails is exactly the model that breaks when they come off.

Resolution: **one file, one deletable block.** `CLAUDE.template.md` carries a `SCAFFOLDING BLOCK`
(the three removed lines, restored verbatim) marked delete-for-frontier / keep-for-weaker, chosen once
at install per `ADAPT.md` → "Scaffolding level". Rejected the alternative of a second
`CLAUDE.template.legacy.md`: two files that must be kept in sync will drift, and every future template
edit would need doing twice.

The block explicitly states it outranks **Output discipline** where they conflict — otherwise a repo that
keeps the scaffolding would ship a template telling the model both to fill in a 5-field form every
close-out and to keep close-outs to a few sentences.

### Harness

**Not covered.** Per the self-repair protocol step 4: `e2e/` tests the deterministic kit (hooks, checker,
sentinel, import command) against seeded sandboxes — `node e2e/tools/unit.mjs` is 15/15 green and
untouched by this change, because no scenario reads `CLAUDE.template.md`'s judgment sections. The e2e
scenarios that mention CLAUDE.md ("Read CLAUDE.md first and follow it") assert on repo state — commits,
INDEX rows, pushed content — never on the shape of the model's report, which is what this change alters.
So the edited file has no automated coverage, and the change is reviewed, not verified. What would cover
it: a scenario scoring close-out length and narration count across model tiers, plus an S9 rerun on
deepseek-v4-flash with the scaffolding block deleted, to confirm the block is load-bearing rather than
assumed to be.
