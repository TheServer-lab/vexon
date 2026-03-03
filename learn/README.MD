# Learn Vexon

Welcome! This folder will teach you Vexon from scratch — no coding experience required.

Each guide builds on the last, so read them in order your first time through.

---

## Table of Contents

| # | Guide | What you'll learn |
|---|-------|-------------------|
| 01 | [Getting Started](01_getting_started.md) | Installing Vexon and running your first program |
| 02 | [Variables](02_variables.md) | Storing and using information |
| 03 | [Numbers & Math](03_numbers.md) | Doing calculations |
| 04 | [Strings](04_strings.md) | Working with text |
| 05 | [Conditions](05_conditions.md) | Making decisions with if / else |
| 06 | [Loops](06_loops.md) | Repeating things with for and while |
| 07 | [Functions](07_functions.md) | Packaging code you can reuse |
| 08 | [Arrays](08_arrays.md) | Lists of things |
| 09 | [Objects](09_objects.md) | Grouping related information together |
| 10 | [Classes](10_classes.md) | Building your own types |
| 11 | [Error Handling](11_errors.md) | Dealing with things that go wrong |
| 12 | [Modules & Imports](12_modules.md) | Using built-in libraries and your own files |

---

## How to use these guides

Every guide contains:
- **Plain-English explanations** — no jargon
- **Code examples** you can copy and run yourself
- **A mini exercise** at the end to test what you learned

To run any code example, save it as a `.vx` file and run:

```
vx yourfile.vx
```

---

## Quick reference

```
// This is a comment — Vexon ignores it

let x = 10              // store a value
print(x)                // show a value

if x > 5 {              // make a decision
  print("big!")
}

for i in range(3) {     // repeat something
  print(i)
}

fn greet(name) {        // reusable block of code
  return "Hello, " + name
}
```

Ready? Start with [Getting Started](01_getting_started.md)
