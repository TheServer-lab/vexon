# 05 — Conditions

A **condition** is a yes-or-no question your program asks. The answer is always either `true` or `false` — these are called **booleans**.

---

## true and false

```
let isRaining = true
let isSunny   = false

print(isRaining)   // true
print(isSunny)     // false
```

---

## Comparison Operators

These compare two values and produce a boolean result:

| Operator | Meaning                  | Example   | Result  |
|----------|--------------------------|-----------|---------|
| `==`     | Equal to                 | `5 == 5`  | `true`  |
| `!=`     | Not equal to             | `5 != 3`  | `true`  |
| `>`      | Greater than             | `10 > 3`  | `true`  |
| `<`      | Less than                | `2 < 8`   | `true`  |
| `>=`     | Greater than or equal to | `5 >= 5`  | `true`  |
| `<=`     | Less than or equal to    | `3 <= 2`  | `false` |

```
let age = 20
print(age >= 18)   // true
print(age == 30)   // false
print(age != 30)   // true
```

---

## if / else

`if` runs code when a condition is true. `else` runs code when it is false:

```
let age = 15

if age >= 18 {
  print("You can vote!")
} else {
  print("Too young to vote.")
}
```

Output:
```
Too young to vote.
```

---

## else if — Multiple Choices

```
let score = 75

if score >= 90 {
  print("Grade: A")
} else if score >= 80 {
  print("Grade: B")
} else if score >= 70 {
  print("Grade: C")
} else {
  print("Grade: F")
}
```

Vexon checks each condition from top to bottom and runs the **first** block that matches.

---

## Combining Conditions

### `&&` — AND (both must be true)

```
let hasTicket   = true
let isOldEnough = true

print(hasTicket && isOldEnough)   // true
```

### `||` — OR (at least one must be true)

```
let hasCash = false
let hasCard = true

print(hasCash || hasCard)   // true
```

### `!` — NOT (flips the value)

```
let isWeekend = false
print(!isWeekend)   // true  (it IS a weekday)
```

---

## A Practical Example

```
let username = "admin"
let password = "secret"

if username == "admin" && password == "secret" {
  print("Welcome!")
} else {
  print("Wrong username or password.")
}
```

---

## Your Turn

1. Create a `temperature` variable. Print "Hot" if above 30, "Warm" if above 20, "Cool" if above 10, and "Cold" otherwise.
2. Create `hasMoney = true` and `hasTime = false`. Print whether you can go shopping (you need both).
3. Create a `speed` variable. Print whether the driver is under the limit (60), at the limit, or speeding.

---

**Next: [06 — Loops](06_loops.md)**
