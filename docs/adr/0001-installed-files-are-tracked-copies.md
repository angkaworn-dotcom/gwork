# Installed files are tracked copies, not generated shims

The usual hook managers write a generated shim into `.git/hooks` (lefthook, pre-commit) or generate wrappers behind `core.hooksPath` (husky), and keep the logic in their own binary or package. gwork instead copies its hooks and checker into the target repo as ordinary tracked files and points `core.hooksPath` at them. We chose this because the enforcement layer must be readable and reviewable in the repo it guards, must work with nothing installed beyond git and Node, and must reach every clone through a normal `git pull`.

## Consequences

- The executable bit of a committed hook matters, and git on Windows hides a wrong one. CI asserts mode `100755` and the installer sets it.
- A copy can be edited in place and drift from the kit. `scripts/gwork-drift.mjs` exists because of this decision, and the installer refuses to overwrite a copy that matches no kit version.
- A fresh clone still needs `core.hooksPath` set once; there is no package lifecycle script to do it.
