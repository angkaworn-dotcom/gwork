# Hooks and the checker stay single-file; only kit-side tools share a library

The default module map and the INDEX row parser are duplicated across the two agent hooks, `tasklog-check.mjs` and `migrate.mjs`. We keep that duplication on purpose: each of those files is copied on its own (one global hook serves every repo; the checker and migrate travel into each repo), so a shared import would turn one copied file into a set that must stay in step, and a half-updated set fails at the moment a gate is supposed to hold. Tools that only ever run from the kit (`gwork-install`, `gwork-drift`, `gwork-log`, `gwork-stats`) do share `scripts/gwork-lib.mjs`.

The Hermes hook reuses the Claude hook's lookup code textually. When the lookup changes, both files change in the same commit.
