# 03 — Numbers & Math

Vexon can do math. All the operators you know from school work here.

---

## Basic Arithmetic

```
print(10 + 3)   // 13
print(10 - 3)   // 7
print(10 * 3)   // 30
print(10 / 3)   // 3.3333...
print(10 % 3)   // 1
```

The `%` operator is called **modulo** — it gives the remainder after division. `10 % 3` is 1 because 10 divided by 3 is 3 with 1 left over.

A common use for modulo: checking if a number is even or odd:

```
let n = 8
print(n % 2)   // 0 means even — any other result means odd
```

---

## Math With Variables

```
let price    = 25
let quantity = 4
let total    = price * quantity

print("Total:", total)   // Total: 100
```

---

## Order of Operations

Vexon follows standard math rules. Use parentheses when you want to override the default order:

```
print(2 + 3 * 4)     // 14  (not 20!)
print((2 + 3) * 4)   // 20
```

---

## The math Module

For more advanced math, load the built-in `math` module:

```
use math

print(math.sqrt(16))      // 4     (square root)
print(math.pow(2, 10))    // 1024  (2 to the power of 10)
print(math.floor(3.9))    // 3     (round down)
print(math.ceil(3.1))     // 4     (round up)
print(math.abs(-7))       // 7     (strip the negative sign)
print(math.PI)            // 3.14159...
```

---

## Random Numbers

`random()` gives a random decimal between 0 and 1:

```
print(random())   // e.g. 0.7341...
```

To simulate a dice roll (1 to 6):

```
use math
let roll = math.floor(random() * 6) + 1
print("You rolled:", roll)
```

---

## Your Turn

1. Calculate how many seconds are in a week: `60 * 60 * 24 * 7`
2. A shop sells apples for $0.40 each. Create variables for price and quantity, calculate the total, and print it.
3. Use `math.pow` to calculate 3 to the power of 5.

---

**Next: [04 — Strings](04_strings.md)**
