# 02 — Variables

A **variable** is a named container that holds a value. Think of it like a labeled box — you put something in, give the box a name, and use that name later to get the value back.

---

## Creating a Variable

Use `let` to create a variable:

```
let name = "Alice"
let age = 30
let score = 9.5
```

Now you can use the variable anywhere:

```
let name = "Alice"
print("Hello,", name)
print(name, "has logged in.")
```

Output:
```
Hello, Alice
Alice has logged in.
```

---

## Changing a Variable

You can update a variable after creating it:

```
let score = 10
print(score)

score = 20
print(score)
```

Output:
```
10
20
```

Notice: you only use `let` the **first time**. After that, just write the name and the new value.

---

## Shorthand Updates

These shortcuts save a lot of typing:

```
let x = 10

x += 5   // same as: x = x + 5  ->  x is now 15
x -= 3   // same as: x = x - 3  ->  x is now 12
x *= 2   // same as: x = x * 2  ->  x is now 24
x /= 4   // same as: x = x / 4  ->  x is now 6

x++      // same as: x = x + 1  ->  x is now 7
x--      // same as: x = x - 1  ->  x is now 6
```

---

## Naming Rules

Variable names can contain letters, numbers, and underscores. They cannot start with a number.

```
let playerName = "Bob"   // good
let score2 = 100         // good
let 2fast = 99           // BAD — cannot start with a number
```

The common style is **camelCase**: start lowercase, capitalise each new word. Like `playerScore`, `firstName`, `totalAmount`.

---

## null — The Empty Box

Sometimes a variable intentionally holds nothing. Vexon uses `null` for that:

```
let result = null
print(result)   // null
```

You will see `null` when a function has nothing useful to return, or when something is not yet known.

---

## Your Turn

1. Create a variable for your name and print a greeting using it.
2. Create a `score` variable, print it, add 10 to it using `+=`, then print it again.
3. Create two variables and print them both on the same line.

---

**Next: [03 — Numbers & Math](03_numbers.md)**
