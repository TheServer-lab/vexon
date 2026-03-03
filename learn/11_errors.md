# 11 — Error Handling

Sometimes things go wrong. A file does not exist. Input is invalid. A network request fails. **Error handling** lets your program deal with these problems gracefully instead of crashing.

---

## The Problem Without Error Handling

If something goes wrong and you have no error handling, your program just stops:

```
let data = json_decode("this is not valid json")
print("We never reach this line")
```

The program crashes. Not a great experience.

---

## try / catch

Wrap risky code in a `try` block. If anything inside it goes wrong, control jumps to the `catch` block instead of crashing:

```
try {
  let data = json_decode("not valid json")
  print("Parsed:", data)
} catch (err) {
  print("Something went wrong:", err.message)
}

print("Program continues normally.")
```

Output:
```
Something went wrong: Unexpected token...
Program continues normally.
```

The program handled the error and kept going.

---

## throw — Raising Your Own Errors

Use `throw` when your code receives invalid input it cannot handle:

```
fn divide(a, b) {
  if b == 0 {
    throw "Cannot divide by zero!"
  }
  return a / b
}

try {
  print(divide(10, 2))   // 5
  print(divide(10, 0))   // this line throws
} catch (err) {
  print("Error:", err)
}
```

Output:
```
5
Error: Cannot divide by zero!
```

---

## A Practical Example: Reading a File

```
try {
  let contents = read("config.txt")
  print("Config loaded successfully.")
  print(contents)
} catch (err) {
  print("Could not read config file. Using default settings.")
}
```

Whether or not the file exists, your program handles it cleanly.

---

## When to Use try / catch

Use it whenever you are:
- Reading or writing files
- Making network requests
- Parsing user input or JSON
- Calling code that might receive bad data

You do not need it for normal logic like loops and math.

---

## Your Turn

1. Try to parse `"hello"` as JSON inside a `try/catch`. Print a friendly message when it fails.
2. Write a function `safeDivide(a, b)` that throws if `b` is zero. Call it inside a `try/catch`.
3. Try to `read` a file that does not exist and handle the error by printing "File not found, using defaults."

---

**Next: [12 — Modules & Imports](12_modules.md)**
