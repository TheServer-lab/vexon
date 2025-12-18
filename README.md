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
- Node.js **v16+** (tested with Node 18)
- Git

**Clone and run**
```bash
git clone <your-repo-url>
cd vexon

npm install
node vexon_cli.js run examples/hello.vx
```

Vexon runs **directly from source using Node.js**. No executables are required.

---

## CLI usage

Vexon ships with a small Node.js CLI:

```bash
node vexon_cli.js run <file.vx> [--debug]
node vexon_cli.js compile <file.vx> [--debug]
```

### Commands

**Run**
```bash
node vexon_cli.js run program.vx
```
- Lexes, parses, compiles, and executes the program on the Vexon VM
- `--debug` prints bytecode execution steps

**Compile (optional)**
```bash
node vexon_cli.js compile program.vx
```
- Compiles `.vx` to Vexon bytecode
- Generates a JS runner and (optionally) a Windows `.exe` using `pkg`
- This is **optional** and not required to use the language

> For safety and transparency, running from source is the recommended path.

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
  vexon_cli.js        # CLI entry point
/src
  vexon_core.js       # Lexer, parser, compiler, VM
/examples
  hello.vx
LICENSE
README.md
package.json
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

**Compiler pipeline**
- Hand-written lexer with line/column tracking
- Pratt parser with operator precedence
- AST → bytecode compiler
- Stack-based virtual machine

**VM highlights**
- Separate call frames with local scopes
- Safe `HALT` handling (functions do not terminate the VM)
- Import system with module caching
- Built-in exception handling (`try` / `catch` / `throw`)

**Design philosophy**
- Minimal syntax
- Explicit control flow
- Small, readable implementation intended for learning and experimentation

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

This project is licensed under the **Vexon Open-Control License (VOCL) 1.0**. See the `LICENSE` file for the full terms and attribution (SPDX identifier: `Apache-2.0`).

---

## Security &

- Vexon can be run entirely from source via Node.js
- No executables are required or trusted by default
- Generated executables (via `pkg`) are optional and user-initiated
- The compiler, VM, and runtime are fully contained in `vexon_core.js`

---

## AI / authorship note

The compiler, VM, and language design were implemented manually. AI tools were used occasionally for **documentation wording and minor refactoring suggestions**, but the architecture, bytecode format, parser, and VM logic were written and debugged by hand.

---

## Contact / further reading

Issues and technical discussions are welcome via the repository.
if you wish to contact me visit: https://vexonlang.blogspot.com/
or send an email at: vexonlang@outlook.com
