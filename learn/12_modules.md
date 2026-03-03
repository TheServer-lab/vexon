# 12 — Modules & Imports

As your programs grow, putting everything in one file becomes messy. **Modules** let you split code across files and reuse it between projects.

---

## Creating a Module

Any `.vx` file can be a module. Create `greetings.vx`:

```
// greetings.vx

fn hello(name) {
  print("Hello,", name)
}

fn goodbye(name) {
  print("Goodbye,", name)
}
```

---

## Importing a Module

In another file, use `import` to load it:

```
// main.vx

import "greetings.vx" as greetings

greetings.hello("Alice")
greetings.goodbye("Bob")
```

Output:
```
Hello, Alice
Goodbye, Bob
```

The `as greetings` part gives the module a name. You then access its functions with `greetings.functionName`.

---

## Splitting a Real Project

Suppose you are building a quiz game. Instead of one large file:

**questions.vx**
```
fn getQuestions() {
  return [
    { question: "What is 2 + 2?",       answer: "4"     },
    { question: "Capital of France?",    answer: "Paris" },
    { question: "Sides on a hexagon?",   answer: "6"     }
  ]
}
```

**quiz.vx**
```
import "questions.vx" as q

let questions = q.getQuestions()
let score = 0

for item in questions {
  print(item.question)
  let answer = input("> ")
  if answer == item.answer {
    print("Correct!")
    score++
  } else {
    print("Wrong! The answer was:", item.answer)
  }
}

print("Final score:", score, "/", len(questions))
```

Each file has one clear responsibility. The project stays organised as it grows.

---

## The Standard Library

Vexon ships with built-in helpers you can import:

```
import "std/std.vx" as std

let numbers = [3, 1, 4, 1, 5, 9]

// Apply a function to every item
let doubled = std.map(numbers, fn(x) { return x * 2 })
print(doubled)   // 6, 2, 8, 2, 10, 18

// Keep only items where the function returns true
let big = std.filter(numbers, fn(x) { return x > 3 })
print(big)   // 4, 5, 9
```

---

## Built-in Modules (use keyword)

Some modules are built into Vexon and loaded with `use` instead of `import`:

```
use math   // math.sqrt, math.floor, math.PI, etc.
use http   // HTTP server and client requests
use os     // operating system info
use gui    // graphical windows, buttons, canvas
```

No file path needed — these come with Vexon.

---

## Your Turn

1. Create `helpers.vx` with functions `double(n)`, `square(n)`, and `half(n)`. Import it and call all three.
2. Create a `config.vx` with variables like `let appName = "MyApp"`. Import it and print the settings.
3. Use `std/std.vx` to filter a list of numbers, keeping only those greater than 10.

---

## What Next?

You have covered the entire core language! Here is where to go from here:

- **Build something.** Pick a small project — a quiz, a to-do list, a calculator — and build it. That is how the language really sticks.
- **Explore `/examples`** in the Vexon repo for working programs covering HTTP servers, file I/O, and more.
- **Try the GUI.** The `/gui` folder has examples using `use gui` to build graphical windows with buttons, canvases, and animations.
- **Read the standard library.** `/std/std.vx` and `/std/math_ext.vx` have useful helpers to explore.

Happy coding!
