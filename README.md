# Vexon — experimental scripting language

Vexon is a lightweight, experimental scripting language with a hand-written **lexer**, **parser**, **compiler**, and **virtual machine** — all implemented from scratch in JavaScript.  
It’s designed to be small and readable, fast to iterate on, and useful for prototyping scripts, tools, and small games.

> **Status:** Experimental — good for learning and prototyping. Not production-ready.

---

## Table of contents
- Quick start
- Run from source (recommended)
- Minimal syntax & examples
- CLI usage
- Project structure
- Design notes & implementation details
- Grammar (mini-BNF)
- Contributing
- License
- Security & trust
- Contact / further reading

---

## Quick start

**Prerequisites**
- Node.js (recommended **v16+**)
- Git

**Clone and run an example**
```bash
git clone <your-repo-url>
cd vexon

npm install
node ./bin/vexon.js examples/hello.vx
```

> Vexon is intended to be run from source using Node.js. No prebuilt executables are required.

---

## Run from source (recommended)

Typical workflow:
1. Create or edit a `.vx` file
2. Run it using the CLI

```bash
node ./bin/vexon.js my_program.vx
```

---

## Minimal syntax & examples

### Hello world
```vexon
message = "Hello, Vexon!"
print(message)
```

### Variables & arithmetic
```vexon
a = 10
b = 3
print(a + b * 2)
```

### Functions
```vexon
function add(x, y) {
    return x + y
}

print(add(2, 3))
```

### Loops
```vexon
i = 0
sum = 0
while i < 5 {
    sum = sum + i
    i = i + 1
}
print(sum)
```

### Modules / imports
```vexon
import "math_utils.vx" as math
print(math["add"](2, 3))
```

---

## CLI usage

```bash
node ./bin/vexon.js path/to/file.vx
```

Optional flags may include:
- `--help`
- `--debug`
- `--repl`

---

## Project structure

```text
/bin
  vexon.js
/src
  lexer.js
  parser.js
  ast.js
  compiler.js
  vm.js
/examples
  hello.vx
LICENSE
README.md
package.json
```

---

## Design notes & implementation details

**Goals**
- Minimal syntax
- Clear compiler pipeline
- Fast edit → run loop

**Architecture**
- Hand-written lexer
- Pratt parser
- Bytecode compiler
- Stack-based VM

**Limitations**
- Experimental
- Limited tooling
- Diagnostics are evolving

---

## Grammar (mini-BNF)

```
program        ::= statement*
statement      ::= var_decl | function_decl | expression_stmt | if_stmt | while_stmt | return_stmt
var_decl       ::= IDENT '=' expression
function_decl  ::= 'function' IDENT? '(' params? ')' '{' statement* '}'
params         ::= IDENT (',' IDENT)*
expression     ::= assignment
```

---

## Contributing

1. Open an issue
2. Fork the repo
3. Create a feature branch
4. Submit a PR

---

## License

Apache-2.0 license. See `LICENSE` for details.

---

## Security & trust

- No prebuilt executables
- Run from source
- Review code before execution

---

## Contact / further reading

Open an issue or discussion for questions about the implementation.

*Thanks for checking out Vexon.*

