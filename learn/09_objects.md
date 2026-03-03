# 09 — Objects

An **object** groups related data together under one name, using **key-value pairs** — like a labelled set of drawers.

---

## Creating an Object

Use curly braces:

```
let person = {
  name: "Alice",
  age: 30,
  city: "London"
}
```

Each entry has a **key** (like `name`) and a **value** (like `"Alice"`), separated by `:`.

---

## Accessing Values

Use a dot `.` to read a value:

```
print(person.name)   // Alice
print(person.age)    // 30
print(person.city)   // London
```

---

## Changing Values

```
person.age = 31
print(person.age)   // 31
```

---

## Adding New Keys

```
let car = { brand: "Toyota", year: 2020 }
car.colour = "red"
print(car.colour)   // red
```

---

## Nested Objects

Objects can contain other objects:

```
let user = {
  name: "Alice",
  address: {
    street: "123 Main St",
    city: "London"
  }
}

print(user.name)           // Alice
print(user.address.city)   // London
```

---

## Objects in Functions

```
fn describe(person) {
  print(person.name, "is", person.age, "and lives in", person.city)
}

let alice = { name: "Alice", age: 30, city: "London" }
let bob   = { name: "Bob",   age: 25, city: "Paris"  }

describe(alice)
describe(bob)
```

---

## Serialising to JSON

`json_encode()` converts an object to text (useful for saving or sending data):

```
let data = { name: "Alice", score: 100 }
print(json_encode(data))
```

`json_decode()` does the reverse.

---

## Your Turn

1. Create an object representing a book (title, author, year, pages). Print each field.
2. Write a function `fullName(person)` that takes an object with `firstName` and `lastName` and prints the full name.
3. Create an array of 3 product objects (each with `name` and `price`) and loop over them to print each one.

---

**Next: [10 — Classes](10_classes.md)**
