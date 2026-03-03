# 08 — Arrays

An **array** is an ordered list of values. Instead of creating a separate variable for each item, you group them together.

---

## Creating an Array

Use square brackets:

```
let fruits  = ["apple", "banana", "cherry"]
let scores  = [95, 87, 100, 72]
let mixed   = ["hello", 42, true]
let empty   = []
```

---

## Accessing Items

Items are accessed by **index** (position), starting at 0:

```
let fruits = ["apple", "banana", "cherry"]

print(fruits[0])   // apple
print(fruits[1])   // banana
print(fruits[2])   // cherry
```

---

## Changing an Item

```
let fruits = ["apple", "banana", "cherry"]
fruits[1] = "mango"
print(fruits[1])   // mango
```

---

## Array Length

```
let scores = [95, 87, 100, 72]
print(len(scores))   // 4
```

---

## Adding and Removing Items

`push()` adds to the end. `pop()` removes from the end and returns the item:

```
let list = ["a", "b"]
push(list, "c")

let last = pop(list)
print(last)    // c
print(list)    // a, b
```

---

## Looping Over an Array

```
let scores = [95, 87, 100, 72]
let total  = 0

for score in scores {
  total += score
}

print("Total:", total)
print("Average:", total / len(scores))
```

Output:
```
Total: 354
Average: 88.5
```

---

## Building an Array Dynamically

```
let evens = []

for i in range(1, 11) {
  if i % 2 == 0 {
    push(evens, i)
  }
}

print(evens)   // 2, 4, 6, 8, 10
```

---

## Arrays of Objects

Arrays often hold structured data:

```
let people = [
  { name: "Alice", age: 30 },
  { name: "Bob",   age: 25 },
  { name: "Carol", age: 35 }
]

for person in people {
  print(person.name, "is", person.age)
}
```

---

## Your Turn

1. Create an array of 5 of your favourite foods and print each one using a loop.
2. Write a function `sum(arr)` that takes an array of numbers and returns their total.
3. Start with `[10, 20, 30]`, push two numbers, pop one, and print the final array.

---

**Next: [09 — Objects](09_objects.md)**
