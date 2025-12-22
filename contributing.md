# Contributing to Vexon

Thank you for your interest in contributing to Vexon — it’s an experimental language and every contribution helps. This document explains the preferred ways to contribute, how to get started, and a few project rules so contributions are smooth and easy to review.

> **Quick summary**
> - Primary place for collaboration: **GitHub Issues & Pull Requests**
> - Private/security contact: **vexonlang@outlook.com**
> - License: **Vexon Open-Control License (VOCL)** — see `LICENSE`.
> - By contributing, you confirm you understand the project license and contribution model (see “License & contributor agreement” below).

---

## Table of contents
- [How to start](#how-to-start)
- [What to contribute](#what-to-contribute)
- [Good first contributions](#good-first-contributions)
- [Reporting bugs and opening issues](#reporting-bugs-and-opening-issues)
- [Submitting changes (PR workflow)](#submitting-changes-pr-workflow)
- [Code style & tests](#code-style--tests)
- [Documentation & examples](#documentation--examples)
- [Tooling & running Vexon locally](#tooling--running-vexon-locally)
- [Security & sensitive issues](#security--sensitive-issues)
- [License & contributor agreement](#license--contributor-agreement)
- [Communication & expectations](#communication--expectations)
- [Maintainer rights & project governance](#maintainer-rights--project-governance)
- [Thank you](#thank-you)

---

## How to start
1. Read the [README](./README.md) and the `LICENSE` (VOCL) to understand goals and licensing.
2. Explore the codebase locally:
   ```bash
   git clone <repo-url>
   cd vexon
   npm install    # if package.json lists dependencies
   node vexon_cli.js run examples/hello.vx
   ```
3. Browse open issues for beginner-friendly items, or open a discussion/issue to propose an idea.

---

## What to contribute
Helpful contributions include (but are not limited to):
- Tooling: dump format improvements, small viewers, CLI flags
- Debugging & diagnostics: better error messages, structured dumps
- Tests: regression tests around known bugs or VM invariants
- Examples & stress programs: long-running loops, small games, simulations
- Docs: clearer language spec, README improvements, tutorials
- Small features and bug fixes

If you’re unsure whether a contribution is welcome, open an issue first to discuss.

---

## Good first contributions
If this is your first time contributing, consider:
- Improving an under-documented `examples/*.vx`
- Adding a simple test that reproduces a bug (or demonstrates desired behavior)
- Small README or README section improvements
- Implementing or improving dump-related tooling

We will label suitable issues as **good first issue** where possible.

---

## Reporting bugs and opening issues
- Use **GitHub Issues** for bug reports, feature requests, and design discussions.
- When opening an issue include:
  - A short descriptive title
  - Steps to reproduce (code example if relevant)
  - Expected vs actual behavior
  - Environment (OS, Node version)
  - Logs, stack traces, or dump output if available

---

## Submitting changes (PR workflow)
1. Fork the repository.
2. Create a descriptive branch:
   ```bash
   git checkout -b feat/<short-description>
   ```
3. Make small, focused commits with clear messages.
4. Add or update tests/examples where appropriate.
5. Push your branch and open a Pull Request against the default branch.
6. In your PR description:
   - Explain the change and motivation
   - Link related issues
   - Describe how the change was tested

---

## Code style & tests
- Follow existing code formatting and patterns.
- Keep changes minimal and reviewable.
- Add tests or examples for significant changes.

---

## Documentation & examples
Documentation is first-class. When you add or change behavior:
- Update README or docs under `docs/`
- Provide runnable examples under `examples/`
- Keep examples small and focused

---

## Tooling & running Vexon locally
Typical development workflow:
```bash
git clone <repo-url>
cd vexon
npm install
node vexon_cli.js run examples/hello.vx
```

If you add tooling, document it clearly.

---

## Security & sensitive issues
If you discover a security issue or something sensitive, **do not open a public issue**. Instead, email:

**vexonlang@outlook.com**

Include a clear description and reproduction steps if possible.

---

## License & contributor agreement
- Vexon is licensed under the **Vexon Open-Control License (VOCL)**.
- By submitting a contribution, you agree that your contribution will be used and redistributed under VOCL, including its contributor clauses.
- If you are not comfortable with this, please do not submit code contributions.

---

## Communication & expectations
- Primary channel: **GitHub Issues & Pull Requests**
- Private contact: **vexonlang@outlook.com**
- No official chat server at this stage
- Maintain respectful and professional communication

---

## Maintainer rights & project governance
- Maintainers have final say on merges
- Large changes should be discussed before implementation
- Not all PRs may be accepted

---

## Thank you
Thank you for your interest in Vexon. Whether you contribute code, documentation, tests, or ideas, your input is appreciated.

**Contact**
- Public discussion: GitHub Issues & PRs
- Private / security matters: **vexonlang@outlook.com**

**License:** Vexon Open-Control License (VOCL). See `LICENSE` for details.
“By submitting a contribution, you agree that your contribution will be licensed under the Vexon Open-Control License (VOCL).”

