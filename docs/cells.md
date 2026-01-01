# Vexon — Cell lifecycle

This document describes the lifecycle, responsibilities, and best practices for **cells** in Vexon. Cells are modular JavaScript files that extend the VM at runtime (kernel, helpers, GUI shim, error handlers, etc.). This reference is written for maintainers, extension authors, and packagers.

---

## Concepts & terminology

- **Runtime (distribution)** — the files shipped with Vexon itself (core VM, CLI, kernel cell). Located next to `vexon_core.cells_ordered.js` and `vexon_cli.cells_ordered.js` (i.e. `__dirname`).
- **Program directory** — the directory that contains the user program (`.vx`) being executed. Referred to as `programDir` or `baseDir` inside the VM.
- **Kernel** — the primary cell shipped with the runtime, usually named `vexon_cell1.js`. The kernel wires VM-level helpers (GUI shim, error messenger, `vm.loadCell`, markers such as `vm._cells` and `vm._cellsLoaded`). Kernel must be applied to every VM instance before running user code.
- **Cells** — auxiliary extension modules named `vexon_cell*.js` (e.g. `vexon_cell2_errors.js`) that implement features. Cells are idempotent and applyable to a VM via `vm.loadCell(name, relPath)` or by requiring them and calling with the VM.
- **Lazy vs autorun** — the kernel may `autoLoadCommonCells()` to attempt non-fatal autorun of a small set of cells. Other cells should be lazy-loaded via `vm.loadCell` or `require(...)(vm)`.

---

## Anatomy of the kernel (what it provides)

The kernel (canonical `vexon_cell1.js`) should:

- Be **idempotent**: calling it multiple times must be safe and not duplicate state. Typical guard: `if (vm._cells && vm._cells.cell1_kernel) return;`.
- Initialize helper containers:
  - `vm._cells = vm._cells || {}` — map of applied cell names
  - `vm._cellsLoaded = vm._cellsLoaded || []` — record of applied cells with timestamps
  - `vm._cellLoadErrors = vm._cellLoadErrors || []` — recorded load failures
  - `vm._kernelVersion = vm._kernelVersion || 'cell1-vX'`
- Provide a *safe require* helper that does not crash the kernel if a module is missing (e.g. `tryRequire`).
- Install `vm.loadCell(name, relPath)` that:
  - Resolves/`require()`s the target cell relative to the kernel file (or uses the path provided)
  - Calls the cell module (if a function) passing the VM
  - Records success in `vm._cells` and `vm._cellsLoaded`
  - Records failures in `vm._cellLoadErrors`
  - Is idempotent (no-op if `vm._cells[name]` exists)
- Install GUI shim if a core GUI is not present (factory `vm.builtins.gui` and `vm.builtins.guiObject`) and expose `vm._gui` with `registry`, `triggerEvent`, `snapshot` and helper methods.
- Wrap `vm.run` so uncaught exceptions create a GUI Error widget via `vm._gui.showError` (but do not swallow the exception).
- Expose read-only diagnostics for language code via `vm.globals.__kernel` and a builtins accessor `vm.builtins.__kernel` (optional but recommended) so `.vx` programs can inspect kernel state without leaking internal objects.

---

## Loading rules — where to load the kernel from

- **Kernel must always be loaded from the runtime directory** (`__dirname`) — this is the Vexon distribution area. Do not attempt to locate `vexon_cell1.js` inside the `programDir` (user program folder). The kernel belongs to the runtime, not the user program.
- The CLI, Electron runtime, generated runners, and packaged `main.js` should load the kernel using `path.join(__dirname, 'vexon_cell1.js')`.
- Program-local `vexon_cell*.js` files (if shipped together with a `.vx`) may be discovered and applied after the kernel is loaded, but this is optional and program-dependent.

---

## Cell application patterns

**From Node / CLI**

```js
const { VM } = require('./vexon_core.cells_ordered');
const applyKernel = require(path.join(__dirname, 'vexon_cell1.js'));
const vm = new VM(consts, code, { baseDir: programDir, debug: true });
applyKernel(vm);
// optionally load program-local cells
vm.loadCell('errors', path.join(programDir, 'vexon_cell2_errors.js'));
```

**Inside a cell module**

The cell module should export `module.exports = function(vm) { ... }` and should avoid creating global variables. Use `vm` for all state.

**Idempotency**

Every cell must be safe to call multiple times. Typical pattern:

```js
module.exports = function(vm) {
  vm._cells = vm._cells || {};
  if (vm._cells['my_cell']) return;
  vm._cells['my_cell'] = true;
  // ... install hooks
}
```

---

## Error handling & exec guard

- Cells that install an exec guard (e.g. `cell3_exec_guard`) should ensure that runtime code execution funnels through a single `vm._exec` guard entrypoint. The guard should capture runtime exceptions, optionally push them into `vm._errors`, and rethrow so the runtime can decide how to handle them.
- The kernel may wire `vm._gui.showError` and `vm._gui.clearError`. The kernel also patches `vm.run` to ensure exceptions create Error widgets.
- Design principle: **do not swallow errors silently**. Record them in `vm._cellLoadErrors` or `vm._errors` as appropriate.

---

## Diagnostics and testing

- **Preferred runtime smoke tests** are Node tests that instantiate `VM`, apply the kernel, and assert capabilities (e.g. presence of `vm._cells.cell1_kernel`, `vm.loadCell` exists, `vm._gui.showError` exists). Do not rely on language-level introspection of JS objects.
- Language-level tests (written in `.vx`) should exercise observable behavior, not internal state. Use a small `__kernel` diagnostics API provided by the kernel to read kernel state from `.vx` if required.
- Recommended Node-side assertions:
  - `vm._cells && vm._cells.cell1_kernel` is truthy
  - `typeof vm.loadCell === 'function'`
  - `typeof vm._gui.showError === 'function'`

---

## Packaging & compiled runners

- When generating a standalone JS runner or packaging an Electron app, **embed or require the runtime kernel by path relative to the packaged runtime** (`__dirname`). The runner must attempt to apply the kernel before calling `vm.run()`.
- For packaged apps, prefer to include `vexon_cell1.js` alongside the packaged core files so the kernel loads deterministically.

---

## Security and sandboxing guidance

- Cells run in the same Node process by default. Treat them as trusted code unless you implement a sandbox.
- For third-party cells (plugins), use strict code review policies or a declarative permission model. Consider requiring plugin authors to use a limited API surface (expose only `vm.safe.*`) and run untrusted plugin code in a separate process if you need strict isolation.

---

## Best practices for cell authors

- Keep cells small and focused (single responsibility).
- Be idempotent.
- Avoid mutating host globals — use `vm` for state.
- Use `tryRequire` or a safe pattern to load optional dependencies.
- Record load failures into `vm._cellLoadErrors` (with `name`, `path`, `error`).
- Provide cleanup hooks if the cell allocates external resources.

---

## Example: minimal cell

```js
module.exports = function(vm) {
  vm._cells = vm._cells || {};
  if (vm._cells['my_cell']) return;
  vm._cells['my_cell'] = true;

  // install a builtin for language use
  vm.globals = vm.globals || {};
  vm.globals.myHelper = vm.globals.myHelper || function(x) { return x + 1; };
};
```

---

## Change log & versioning

- v1 — initial lifecycle and kernel wiring conventions
- v1.1 — added `vm.globals.__kernel` diagnostics helper

---

## FAQ

**Q:** Where should I put `vexon_cell2_errors.js`?  
**A:** Ship it alongside the runtime and let the kernel attempt autorun, or load it explicitly from `programDir` if it's program-specific.

**Q:** Should kernel mutate `vm.globals`?  
**A:** Kernel may expose curated read-only helpers (e.g. `__kernel`) but avoid leaking internal objects.

---

If you want, I can also:
- create a `docs/` README containing this and a diagram,
- add a small `cells_test.js` harness that validates the conventions,
- or convert this into a Markdown file in your repo automatically.

