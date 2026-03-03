# 07 — Functions

A **function** is a reusable block of code. Instead of writing the same logic multiple times, you write it once as a function and call it by name.

---

## Defining a Function

Use `fn` to define a function:

```
fn sayHello() {
  print("Hello!")
}
```

This defines the function but does not run it. To run it, you **call** it:

```
sayHello()
sayHello()
sayHello()
```

Output:
```
Hello!
Hello!
Hello!
```

---

## Parameters — Giving Input to a Function

A **parameter** is a variable that receives a value when the function is called:

```
fn greet(name) {
  print("Hello,", name)
}

greet("Alice")
greet("Bob")
```

Output:
```
Hello, Alice
Hello, Bob
```

Multiple parameters are separated by commas:

```
fn introduce(name, age) {
  print(name, "is", age, "years old.")
}

introduce("Alice", 30)
```

---

## Return Values — Getting Output Back

Use `return` to send a value back to the caller:

```
fn add(a, b) {
  return a + b
}

let result = add(5, 3)
print(result)   // 8
```

Return values can be used directly:

```
print(add(10, 20))         // 30
print(add(1, add(2, 3)))   // 6
```

---

## A Practical Example

```
fn celsiusToFahrenheit(c) {
  return c * 9 / 5 + 32
}

print(celsiusToFahrenheit(0))    // 32
print(celsiusToFahrenheit(100))  // 212
print(celsiusToFahrenheit(37))   // 98.6
```

---

## Functions as Values

In Vexon, functions are values like numbers or strings. You can store one in a variable:

```
let double = fn(x) {
  return x * 2
}

print(double(5))    // 10
print(double(21))   // 42
```

This is called an **anonymous function** (it has no name of its own).

---

## Your Turn

1. Write a function `square(n)` that returns `n * n`. Test it with a few numbers.
2. Write a function `isEven(n)` that returns `true` if `n` is even and `false` if odd. (Hint: use `%`)
3. Write a function `max(a, b)` that returns whichever number is larger.

---

**Next: [08 — Arrays](08_arrays.md)**
