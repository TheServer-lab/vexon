# 04 — Strings

A **string** is any piece of text. In Vexon, strings go inside quote marks.

---

## Creating Strings

You can use double quotes, single quotes, or backticks — they all work the same:

```
let a = "Hello"
let b = 'World'
let c = `It works!`
```

---

## Joining Strings Together

Use `+` to join (concatenate) strings:

```
let first  = "Hello"
let second = "World"
print(first + " " + second)   // Hello World
```

The `" "` in the middle adds the space. Without it you get `HelloWorld`.

---

## Strings and Numbers

Use `toString()` to convert a number to a string when joining:

```
let score = 42
print("Your score: " + toString(score))   // Your score: 42
```

---

## String Length

`len()` tells you how many characters a string has:

```
let word = "Vexon"
print(len(word))   // 5
```

Spaces count as characters: `len("hi there")` is 8.

---

## Escape Characters

Some characters are tricky to include inside a string. Use a backslash to insert them:

| Code | What it does |
|------|--------------|
| `\n` | New line     |
| `\t` | Tab indent   |

```
print("Line one\nLine two\nLine three")
```

Output:
```
Line one
Line two
Line three
```

---

## Accessing a Single Character

Access any character by its **index** (position), starting at 0:

```
let word = "Vexon"
print(word[0])   // V
print(word[1])   // e
print(word[4])   // n
```

The first character is always index `0`.

---

## Your Turn

1. Create variables for your first and last name. Print your full name by joining them with a space.
2. Create a word and use `len()` to print how many letters it has.
3. Print a message that spans three lines using `\n`.

---

**Next: [05 — Conditions](05_conditions.md)**
