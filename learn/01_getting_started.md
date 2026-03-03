# 01 — Getting Started

## Your First Program

Create a file called `hello.vx` and type this inside it:

```
print("Hello, world!")
```

Now run it:

```
vx hello.vx
```

You should see:

```
Hello, world!
```

That's it — you just wrote and ran your first Vexon program.

---

## The `print` Function

`print` is how Vexon shows output. You can print anything:

```
print("Hello!")
print(42)
print(true)
```

Output:
```
Hello!
42
true
```

You can print multiple things on one line by separating them with commas:

```
print("My name is", "Alice")
print("I am", 30, "years old")
```

Output:
```
My name is Alice
I am 30 years old
```

---

## Comments

A comment is a note in your code that Vexon ignores. It's just for you (or other humans reading your code).

Comments start with `//`:

```
// This is a comment — Vexon won't run this line
print("But this line runs!")

print("Hello") // You can also add comments after code
```

Use comments to explain what your code does. Get in the habit early.

---

## Your Turn

Try changing `hello.vx` to print your own name and something about yourself:

```
print("Hello! My name is Alice.")
print("I am learning Vexon.")
print("This is fun!")
```

Once you're comfortable, move on to the next lesson.

---

**Next: [02 — Variables](02_variables.md)**
