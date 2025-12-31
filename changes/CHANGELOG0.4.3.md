# CHANGELOG.md — Vexon 0.4.3

## Overview
Vexon 0.4.3 is a stabilization-focused release. The goal of this version is to lock down language rules, clarify GUI behavior, and improve error reporting.

---

## Language
### Clarified Behavior
- `let` declarations must include an initializer.
- `fn` is statement-only (no anonymous or inline functions).
- Ternary operator (`?:`) is not supported.
- Parser errors now consistently report token, line, and column.

### Known Limitations
- No anonymous functions or lambdas.
- Limited expression grammar by design.

---

## GUI
- Immediate-mode GUI model is now the defined behavior.
- GUI must be redrawn manually for animated or canvas-based UIs.
- Widgets must be added before calling `show()`.

---

## Error Handling
- Python-style traceback support added through GUI error widgets.
- Runtime errors surface more clearly in both CLI and GUI.

---

## Cells
- Improved defensive initialization.
- Reduced undefined behavior during cell loading.

---

## Breaking Changes
None intentional. Previously undefined behavior may now throw explicit errors.

---

## Summary
Vexon 0.4.3 prioritizes predictability, clarity, and stability over new features.
