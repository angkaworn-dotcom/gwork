<!-- ▼▼ SCAFFOLDING BLOCK — DELETE for frontier models · KEEP for weaker/older/small models.
     Decide once at install: gwork's ADAPT.md → "Scaffolding level". Why it is conditional:
     these lines are process a frontier model already runs on its own, where they only buy length
     and over-verification. Keeping them for weaker models is a PRECAUTION with no evidence behind
     it: e2e S12 (2026-07-26) measured both arms on two models and found no protective effect —
     the weak model self-authorized slightly MORE often with this block than without. Do not treat
     keeping it as a safety measure. Full result: MODEL-NOTES.md M-002. ▼▼ -->

### Verification scaffolding (weaker models only)

- **Read before write:** investigate → root cause → design (≥2 options) → implement, in that order, no skipping ahead
- **Self-review from 4 angles before push:** Logic · Security · Data · Code quality
- **Final delivery format, every close-out:**

```
Summary:    what changed + why
Evidence:   files/observations that support it
Risks:      none = write "none"
Validation: tests/checks actually run
Confidence: HIGH / MEDIUM / LOW
```

- Where this block conflicts with **Output discipline** above, this block wins — for these models the completeness is worth the length

<!-- ▲▲ END SCAFFOLDING BLOCK ▲▲ -->
