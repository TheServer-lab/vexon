# 06 — Loops

A **loop** runs the same code multiple times. Instead of writing `print("hello")` ten times, you write it once inside a loop.

---

## The for Loop

`for` goes through a list of items, one at a time:

```
for i in range(5) {
  print(i)
}
```

Output:
```
0
1
2
3
4
```

`range(5)` creates the list `[0, 1, 2, 3, 4]`. It starts at 0 and stops *before* 5.

To start at a different number, pass two arguments:

```
for i in range(1, 6) {
  print(i)
}
// Prints 1 through 5
```

---

## Looping Over an Array

```
let fruits = ["apple", "banana", "cherry"]

for fruit in fruits {
  print(fruit)
}
```

Output:
```
apple
banana
cherry
```

The variable `fruit` holds a different item each time the loop runs.

---

## The while Loop

A `while` loop keeps running as long as a condition is true:

```
let count = 1

while count <= 5 {
  print(count)
  count++
}
```

Output: 1, 2, 3, 4, 5

Always make sure something inside the loop eventually makes the condition false — otherwise it runs forever!

---

## break — Stop Early

```
for i in range(10) {
  if i == 4 {
    break
  }
  print(i)
}
// Output: 0 1 2 3
```

---

## continue — Skip to the Next Step

```
for i in range(6) {
  if i == 3 {
    continue
  }
  print(i)
}
// Output: 0 1 2 4 5
```

---

## A Real Example: FizzBuzz

Print numbers 1-20, but say "Fizz" for multiples of 3, "Buzz" for multiples of 5, and "FizzBuzz" for both:

```
for i in range(1, 21) {
  if i % 15 == 0 {
    print("FizzBuzz")
  } else if i % 3 == 0 {
    print("Fizz")
  } else if i % 5 == 0 {
    print("Buzz")
  } else {
    print(i)
  }
}
```

---

## Your Turn

1. Print all even numbers from 2 to 20. (Hint: use `%`)
2. Use a loop to calculate the sum of all numbers from 1 to 100. (Answer should be 5050.)
3. Loop through `["dog", "cat", "fish", "bird"]` and print each one with "I have a " in front.

---

**Next: [07 — Functions](07_functions.md)**
