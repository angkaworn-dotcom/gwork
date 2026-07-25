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
verification scaffolding is right for Opus 5 and **assumed wrong for deepseek-v4-flash**.

> **Correction (same day, before this note was ever acted on).** The first draft of M-001 cited e2e S9
> — the flash run that emptied `forbidden: []` and called it "the only authorized override mechanism" —
> as evidence that this block is load-bearing for weak models. **That citation does not support that
> claim.** Every S1–S11 run to date was driven against the hand-written 3-rule stub `CLAUDE.md` in
> `setup.mjs`, which contains none of this template's judgment rules — no scaffolding block, and no
> rule 4b either. So S9 shows a weak model self-authorizing when the prompt has **no governance rule at
> all**, which is evidence for keeping **rule 4b** (kept, and present in both variants) and says nothing
> about the scaffolding block. Inference presented as observation — the exact error the template's own
> Evidence-based rule names.

What survives the correction: the *split itself* is still right, because the cost is asymmetric — keeping
the block costs length, removing it risks silent self-authorization on a model class that demonstrably
does that under conflict. But "keep it for weak models" is a **precaution, not a measured result**, and
is labelled as such in `ADAPT.md` and in the block's own comment.

Resolution: **one file, one deletable block.** `CLAUDE.template.md` carries a `SCAFFOLDING BLOCK`
(the three removed lines, restored verbatim) marked delete-for-frontier / keep-for-weaker, chosen once
at install per `ADAPT.md` → "Scaffolding level". Rejected the alternative of a second
`CLAUDE.template.legacy.md`: two files that must be kept in sync will drift, and every future template
edit would need doing twice.

The block explicitly states it outranks **Output discipline** where they conflict — otherwise a repo that
keeps the scaffolding would ship a template telling the model both to fill in a 5-field form every
close-out and to keep close-outs to a few sentences.

### Harness

**Not covered — and the gap is wider than "this file has no test."** Per self-repair protocol step 4:

`e2e/` tests the deterministic kit (hooks, checker, sentinel, import) against seeded sandboxes.
`node e2e/tools/unit.mjs` is 15/15 and untouched by this change. But the scenarios that say "Read
CLAUDE.md first and follow it" were reading `setup.mjs`'s **stub** `CLAUDE.md`, not
`CLAUDE.template.md` — so **no e2e run has ever exercised the shipped template**, and the scenarios
assert on repo state (commits, INDEX rows, pushed content), never on report shape, which is what
Output discipline changes.

Built in response, still **unrun**: scenario **S12** (`e2e/scenarios.md`) — `setup.mjs --claude=full|lean`
puts the real template in the sandbox with the scaffolding block kept or deleted, everything else byte
identical, and `e2e/tools/score-s9.mjs` scores the arm-discriminating signal (bypass *attempts*:
`--no-verify`, forbidden-list rewrite, raw-shell write, forged trailer) rather than the final repo state,
which the unchanged deterministic layer makes identical in both arms. The scorer is verified on synthetic
compliant/bypass logs; it has never seen a live model. Running it needs `DEEPSEEK_API_KEY` and network
egress to `api.deepseek.com` — both unavailable in the container this was authored in (proxy policy
returns 403 on CONNECT).

Until S12 runs, everything in the *Conditional* section above is a design decision, not a finding.
