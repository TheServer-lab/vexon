# 10 — Classes

A **class** is a blueprint for creating objects. When you have lots of similar objects — many users, many enemies in a game — a class lets you define their shape and behaviour once, then create as many as you need.

---

## Defining a Class

```
class Dog {
  fn init(name, breed) {
    this.name  = name
    this.breed = breed
  }

  fn bark() {
    print(this.name, "says: Woof!")
  }

  fn describe() {
    print(this.name, "is a", this.breed)
  }
}
```

Things to notice:
- `init` runs automatically when you create a new Dog. It is where you store initial values.
- `this` refers to the specific object being used right now.
- `bark` and `describe` are **methods** — functions that belong to the class.

---

## Creating Objects From a Class

```
let rex  = Dog("Rex", "German Shepherd")
let luna = Dog("Luna", "Labrador")

rex.bark()       // Rex says: Woof!
luna.bark()      // Luna says: Woof!
rex.describe()   // Rex is a German Shepherd
```

Each object is completely independent — changing `rex` has no effect on `luna`.

---

## A Fuller Example

```
class BankAccount {
  fn init(owner, balance) {
    this.owner   = owner
    this.balance = balance
  }

  fn deposit(amount) {
    this.balance += amount
    print("Deposited", amount, "- Balance:", this.balance)
  }

  fn withdraw(amount) {
    if amount > this.balance {
      print("Not enough funds!")
      return false
    }
    this.balance -= amount
    print("Withdrew", amount, "- Balance:", this.balance)
    return true
  }

  fn getBalance() {
    return this.balance
  }
}

let account = BankAccount("Alice", 1000)
account.deposit(500)
account.withdraw(200)
print("Final balance:", account.getBalance())
```

Output:
```
Deposited 500 - Balance: 1500
Withdrew 200 - Balance: 1300
Final balance: 1300
```

---

## Why Use Classes?

Without classes, to represent 100 users you would need 100 separate objects and duplicate functions everywhere. With a `User` class you write the logic once. Your code stays clean as it grows.

---

## Your Turn

1. Create a `Rectangle` class with `width` and `height`, and methods `area()` and `perimeter()`.
2. Create a `Counter` class with `count` starting at 0, and methods `increment()`, `decrement()`, and `reset()`.
3. Create two separate `BankAccount` objects and confirm that deposits on one do not affect the other.

---

**Next: [11 — Error Handling](11_errors.md)**
