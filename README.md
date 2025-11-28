# Vexon Programming Language

Vexon is a lightweight, experimental scripting language featuring its own **lexer**, **parser**, **compiler**, and **virtual machine** — all written from scratch.  
It aims to be simple to learn, fun to hack on, and flexible enough to power real-world scripts, tools, and games.

---

## 🚀 Features

### ✔️ Custom VM
Vexon runs on its own highly optimized virtual machine with:
- Stack-based execution  
- Tailored bytecode format  
- Safe error handling  
- Clean stack frames & call structure  

### ✔️ Full Compiler Pipeline
- Lexer  
- Pratt parser  
- Bytecode generator  
- Optimized execution engine  

### ✔️ Built-in Standard Library
Includes built-ins such as:
- `print`, `input`
- `fs` & file utilities
- `json` parser
- `math` & number helpers
- `string` utilities
- Timer & async helpers

### ✔️ Module / Import System
Vexon supports importing `.vx` files using:
```vx
import "math_utils.vx" as math
print(math["add"](2, 3))
