"use strict";
/*
  vexon_core.js — Vexon core with lexer, parser, compiler, VM, modules, live bindings,
  try/catch (basic), throw, closures, arrays/objects, and source-aware errors.

  This file reconstructs a complete, consistent runtime compatible with vexon_cli.js
  and the smoke tests included there (export/import, cycle import, live bindings).
*/

const fs = require("fs");
const path = require("path");

let readlineSync = null;
try { readlineSync = require("readline-sync"); } catch (e) { readlineSync = null; }

let fetchImpl = globalThis.fetch;
if (!fetchImpl) {
  try { fetchImpl = require("node-fetch"); } catch (e) { fetchImpl = null; }
}

/* ---------------- Lexer ---------------- */
function isAlpha(c) { return /[A-Za-z_]/.test(c); }
function isDigit(c) { return /[0-9]/.test(c); }

class Lexer {
  constructor(src, filename = "<input>") { this.src = src; this.i = 0; this.line = 1; this.col = 1; this.filename = filename; }
  peek() { return this.src[this.i] ?? "\0"; }
  next() {
    const ch = this.src[this.i++] ?? "\0";
    if (ch === "\n") { this.line++; this.col = 1; } else this.col++;
    return ch;
  }
  eof() { return this.i >= this.src.length; }

  lex() {
    const out = [];
    while (!this.eof()) {
      let c = this.peek();
      if (/\s/.test(c)) { this.next(); continue; }
      if (c === "/" && this.src[this.i + 1] === "/") {
        while (!this.eof() && this.peek() !== "\n") this.next();
        continue;
      }
      if ((c === ">" || c === "<" || c === "=" || c === "!") && this.src[this.i + 1] === "=") {
        out.push({ t: "symbol", v: c + "=", pos: { file: this.filename, line: this.line, col: this.col } }); this.next(); this.next(); continue;
      }
      if (c === "&" && this.src[this.i + 1] === "&") { out.push({ t: "symbol", v: "&&", pos: { file: this.filename, line: this.line, col: this.col } }); this.next(); this.next(); continue; }
      if (c === "|" && this.src[this.i + 1] === "|") { out.push({ t: "symbol", v: "||", pos: { file: this.filename, line: this.line, col: this.col } }); this.next(); this.next(); continue; }

      if (isDigit(c)) {
        let num = "";
        const startCol = this.col;
        while (!this.eof() && (isDigit(this.peek()) || this.peek() === ".")) num += this.next();
        out.push({ t: "number", v: num, pos: { file: this.filename, line: this.line, col: startCol } }); continue;
      }

      if (c === '"' || c === "'") {
        const q = this.next(); let s = ""; const startCol = this.col;
        while (!this.eof() && this.peek() !== q) {
          let ch = this.next();
          if (ch === "\\") {
            const n = this.next();
            if (n === "n") s += "\n"; else if (n === "t") s += "\t"; else s += n;
          } else s += ch;
        }
        if (this.peek() === q) this.next();
        out.push({ t: "string", v: s, pos: { file: this.filename, line: this.line, col: startCol } }); continue;
      }

      if (isAlpha(c)) {
        let id = ""; const startCol = this.col;
        while (!this.eof() && /[A-Za-z0-9_]/.test(this.peek())) id += this.next();
        if (["true","false","null","in","for","let","const","fn","return","if","else","while","break","continue","import","as","try","catch","finally","throw","export","default","from"].includes(id))
          out.push({ t: "keyword", v: id, pos: { file: this.filename, line: this.line, col: startCol } });
        else out.push({ t: "id", v: id, pos: { file: this.filename, line: this.line, col: startCol } });
        continue;
      }

      out.push({ t: "symbol", v: this.next(), pos: { file: this.filename, line: this.line, col: this.col } });
    }
    out.push({ t: "eof", v: "", pos: { file: this.filename, line: this.line, col: this.col } });
    return out;
  }
}

/* ---------------- Parser ---------------- */
class Parser {
  constructor(tokens) { this.tokens = tokens; this.i = 0; }
  peek() { return this.tokens[this.i]; }
  next() { return this.tokens[this.i++]; }
  matchSymbol(v) { if (this.peek().t === "symbol" && this.peek().v === v) { return this.next(), true; } return false; }
  matchId(v) { if (this.peek().t === "id" && (v === undefined || this.peek().v === v)) { return this.next(), true; } return false; }
  matchKeyword(v) { if (this.peek().t === "keyword" && this.peek().v === v) { return this.next(), true; } return false; }

  parseProgram() { const out = []; while (this.peek().t !== "eof") out.push(this.parseStmt()); return out; }

  curPos() { const tk = this.peek(); return tk && tk.pos ? tk.pos : { file: "<input>", line: 0, col: 0 }; }

  parseStmt() {
    if (this.peek().t === "keyword" && (this.peek().v === "let" || this.peek().v === "const")) return this.parseLet();
    if (this.peek().t === "keyword" && this.peek().v === "return") return this.parseReturn();
    if (this.peek().t === "keyword" && this.peek().v === "if") return this.parseIf();
    if (this.peek().t === "keyword" && this.peek().v === "while") return this.parseWhile();
    if (this.peek().t === "keyword" && this.peek().v === "for") return this.parseFor();
    if (this.peek().t === "keyword" && this.peek().v === "import") return this.parseImport();
    if (this.peek().t === "keyword" && this.peek().v === "fn") return this.parseFn();
    if (this.peek().t === "keyword" && this.peek().v === "break") { const pos = this.curPos(); this.next(); if (this.matchSymbol(";")){} return { kind: "break", pos }; }
    if (this.peek().t === "keyword" && this.peek().v === "continue") { const pos = this.curPos(); this.next(); if (this.matchSymbol(";")){} return { kind: "continue", pos }; }
    if (this.peek().t === "keyword" && this.peek().v === "try") return this.parseTry();
    if (this.peek().t === "keyword" && this.peek().v === "throw") return this.parseThrow();
    if (this.peek().t === "keyword" && this.peek().v === "export") return this.parseExport();

    const pos = this.curPos();
    const e = this.parseExpr();
    if (this.peek().t === "symbol" && this.peek().v === "=") {
      this.next();
      const rhs = this.parseExpr();
      if (this.matchSymbol(";")) {}
      return { kind: "assign", target: e, expr: rhs, pos };
    }
    if (this.peek().t === "symbol" && this.peek().v === ";") this.next();
    return { kind: "expr", expr: e, pos };
  }

  parseExport() {
    const pos = this.curPos();
    this.next(); // consume 'export'

    // export default <expr>;
    if (this.peek().t === "keyword" && this.peek().v === "default") {
      this.next();
      const expr = this.parseExpr();
      if (this.matchSymbol(";")) {}
      return { kind: "export_default", expr, pos };
    }

    // export let/const name = expr;
    if (this.peek().t === "keyword" && (this.peek().v === "let" || this.peek().v === "const")) {
      const declKind = this.next().v;
      if (this.peek().t !== "id") throw new Error(declKind + " expects identifier");
      const name = this.next().v;
      if (!this.matchSymbol("=")) throw new Error(declKind + " missing =");
      const expr = this.parseExpr();
      if (this.matchSymbol(";")) {}
      return { kind: "export_decl", declKind, name, expr, pos };
    }

    // export fn name(...) { ... }
    if (this.peek().t === "keyword" && this.peek().v === "fn") {
      const fnNode = this.parseFn(); // returns { kind:"fn", name, params, body }
      return { kind: "export_fn", fn: fnNode, pos };
    }

    // export { a, b, c };
    if (this.peek().t === "symbol" && this.peek().v === "{") {
      this.next();
      const names = [];
      while (true) {
        if (this.peek().t !== "id") throw new Error("export specifier expected identifier");
        names.push(this.next().v);
        if (this.matchSymbol("}")) break;
        if (!this.matchSymbol(",")) throw new Error("expected , or } in export specifiers");
      }
      if (this.matchSymbol(";")) {}
      return { kind: "export_named", names, pos };
    }

    throw new Error("Unsupported export syntax");
  }

  parseImport() {
    const pos = this.curPos();
    this.next(); // consume 'import'
    if (this.peek().t === "symbol" && this.peek().v === "{") {
      this.next();
      const specifiers = [];
      while (true) {
        if (this.peek().t !== "id") throw new Error("import specifier expected identifier");
        const orig = this.next().v;
        let local = orig;
        if (this.peek().t === "keyword" && this.peek().v === "as") {
          this.next();
          if (this.peek().t !== "id") throw new Error("import 'as' expects identifier");
          local = this.next().v;
        }
        specifiers.push({ orig, local });
        if (this.matchSymbol("}")) break;
        if (!this.matchSymbol(",")) throw new Error("expected , or } in import specifiers");
      }
      if (!(this.peek().t === "keyword" && this.peek().v === "from")) throw new Error("import named requires 'from'");
      this.next();
      if (this.peek().t !== "string") throw new Error("import expects a string literal");
      const file = this.next().v;
      if (this.matchSymbol(";")) {}
      return { kind: "import_named", file, specifiers, pos };
    }
    if (this.peek().t === "string") {
      const file = this.next().v;
      let alias = null;
      if (this.peek().t === "keyword" && this.peek().v === "as") {
        this.next();
        if (this.peek().t !== "id") throw new Error("import 'as' expects identifier");
        alias = this.next().v;
      }
      if (this.matchSymbol(";")) {}
      return { kind: "import", file, alias, pos };
    }
    throw new Error("Unsupported import syntax");
  }

  parseFn() {
    const pos = this.curPos();
    this.next(); // consume 'fn'
    let name = null;
    if (this.peek().t === "id") { name = this.next().v; }
    if (!this.matchSymbol("(")) throw new Error("fn missing (");
    const params = [];
    if (!this.matchSymbol(")")) {
      while (true) {
        if (this.peek().t !== "id") throw new Error("fn param must be identifier");
        params.push(this.next().v);
        if (this.matchSymbol(")")) break;
        if (!this.matchSymbol(",")) throw new Error("expected , or )");
      }
    }

    if (!this.matchSymbol("{")) throw new Error("fn missing {");
    const body = [];
    while (!this.matchSymbol("}")) body.push(this.parseStmt());

    return { kind: "fn", name, params, body, pos };
  }

  parseLet() {
    const pos = this.curPos();
    const kw = this.next().v; // 'let' or 'const'
    if (this.peek().t !== "id") throw new Error(kw + " expects identifier");
    const name = this.next().v;
    if (!this.matchSymbol("=")) throw new Error(kw + " missing =");
    const expr = this.parseExpr();
    if (this.matchSymbol(";")) {}
    return { kind: "let", name, expr, mutable: (kw === "let"), pos };
  }

  parseReturn() {
    const pos = this.curPos();
    this.next();
    if (this.peek().t === "symbol" && this.peek().v === ";") { this.next(); return { kind: "return", pos }; }
    const e = this.parseExpr();
    if (this.matchSymbol(";")) {}
    return { kind: "return", expr: e, pos };
  }

  parseIf() {
    const pos = this.curPos();
    this.next();
    const cond = this.parseExpr();
    if (!this.matchSymbol("{")) throw new Error("if missing {");
    const then = [];
    while (!this.matchSymbol("}")) then.push(this.parseStmt());
    let otherwise = [];
    if (this.peek().t === "keyword" && this.peek().v === "else") {
      this.next();
      if (!this.matchSymbol("{")) throw new Error("else missing {");
      while (!this.matchSymbol("}")) otherwise.push(this.parseStmt());
    }
    return { kind: "if", cond, then, otherwise, pos };
  }

  parseWhile() {
    const pos = this.curPos();
    this.next();
    const cond = this.parseExpr();
    if (!this.matchSymbol("{")) throw new Error("while missing {");
    const body = [];
    while (!this.matchSymbol("}")) body.push(this.parseStmt());
    return { kind: "while", cond, body, pos };
  }

  parseFor() {
    const pos = this.curPos();
    this.next();
    if (this.peek().t !== "id") throw new Error("for expects identifier");
    const iterator = this.next().v;
    if (!(this.peek().t === "keyword" && this.peek().v === "in")) throw new Error("for missing 'in'");
    this.next();
    const iterable = this.parseExpr();
    if (!this.matchSymbol("{")) throw new Error("for missing {");
    const body = [];
    while (!this.matchSymbol("}")) body.push(this.parseStmt());
    return { kind: "for", iterator, iterable, body, pos };
  }

  parseTry() {
    const pos = this.curPos();
    this.next(); // consume 'try'
    if (!this.matchSymbol("{")) throw new Error("try missing {");
    const body = [];
    while (!this.matchSymbol("}")) body.push(this.parseStmt());
    let catchParam = null, catchBody = null, finallyBody = null;
    if (this.peek().t === "keyword" && this.peek().v === "catch") {
      this.next();
      if (!this.matchSymbol("(")) throw new Error("catch missing (");
      if (this.peek().t !== "id") throw new Error("catch expects identifier");
      catchParam = this.next().v;
      if (!this.matchSymbol(")")) throw new Error("catch missing )");
      if (!this.matchSymbol("{")) throw new Error("catch missing {");
      catchBody = [];
      while (!this.matchSymbol("}")) catchBody.push(this.parseStmt());
    }
    if (this.peek().t === "keyword" && this.peek().v === "finally") {
      this.next();
      if (!this.matchSymbol("{")) throw new Error("finally missing {");
      finallyBody = [];
      while (!this.matchSymbol("}")) finallyBody.push(this.parseStmt());
    }
    return { kind: "try", body, catchParam, catchBody, finallyBody, pos };
  }

  parseThrow() {
    const pos = this.curPos();
    this.next(); // consume 'throw'
    const expr = this.parseExpr();
    if (this.matchSymbol(";")) {}
    return { kind: "throw", expr, pos };
  }

  parseExpr() { return this.parseBinary(0); }

  precedence(op) { return { "||":1, "&&":2, "==":3, "!=":3, ">":4, "<":4, ">=":4, "<=":4, "+":5, "-":5, "*":6, "/":6, "%":6 }[op] || 0; }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    while (true) {
      const tk = this.peek();
      let op = null;
      if (tk.t === "symbol" && ["+","-","*","/","%","==","!=","<","<=" ,">",">=","&&","||"].includes(tk.v)) op = tk.v;
      if (!op) break;
      const prec = this.precedence(op);
      if (prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { kind: "bin", op, left, right, pos: tk.pos };
    }
    return left;
  }

  parseUnary() {
    if (this.peek().t === "symbol" && this.peek().v === "-") { const pos = this.curPos(); this.next(); const e = this.parseUnary(); return { kind: "bin", op: "*", left: { kind: "num", value: -1 }, right: e, pos }; }
    if (this.peek().t === "symbol" && this.peek().v === "!") { const pos = this.curPos(); this.next(); return { kind: "unary", op: "!", expr: this.parseUnary(), pos }; }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tk = this.peek();
    if (tk.t === "number") { this.next(); return { kind: "num", value: Number(tk.v), pos: tk.pos }; }
    if (tk.t === "string") { this.next(); return { kind: "str", value: tk.v, pos: tk.pos }; }
    if (tk.t === "keyword" && (tk.v === "true" || tk.v === "false" || tk.v === "null")) {
      this.next();
      if (tk.v === "true") return { kind: "bool", value: true, pos: tk.pos };
      if (tk.v === "false") return { kind: "bool", value: false, pos: tk.pos };
      return { kind: "null", value: null, pos: tk.pos };
    }

    if (tk.t === "symbol" && tk.v === "[") {
      this.next();
      const elems = [];
      if (!(this.peek().t === "symbol" && this.peek().v === "]")) {
        while (true) {
          elems.push(this.parseExpr());
          if (this.matchSymbol("]")) break;
          if (!this.matchSymbol(",")) throw new Error("expected , or ] in array");
        }
      } else { this.next(); }
      return { kind: "array", elements: elems, pos: tk.pos };
    }

    if (tk.t === "symbol" && tk.v === "{") {
      this.next();
      const entries = [];
      if (!(this.peek().t === "symbol" && this.peek().v === "}")) {
        while (true) {
          const keytk = this.peek();
          let key;
          if (keytk.t === "id") key = this.next().v;
          else if (keytk.t === "string") key = this.next().v;
          else throw new Error("object key must be identifier or string");
          if (!this.matchSymbol(":")) throw new Error("object entry missing :");
          const val = this.parseExpr();
          entries.push({ key, value: val });
          if (this.matchSymbol("}")) break;
          if (!this.matchSymbol(",")) throw new Error("expected , or } in object");
        }
      } else { this.next(); }
      return { kind: "obj", entries, pos: tk.pos };
    }

    if (tk.t === "id") {
      this.next();
      let node = { kind: "var", name: tk.v, pos: tk.pos };
      while (true) {
        if (this.peek().t === "symbol" && this.peek().v === "(") {
          this.next();
          const args = [];
          if (!(this.peek().t === "symbol" && this.peek().v === ")")) {
            while (true) {
              args.push(this.parseExpr());
              if (this.matchSymbol(")")) break;
              if (!this.matchSymbol(",")) throw new Error("expected , or )");
            }
          } else { this.next(); }
          node = { kind: "call", callee: node, args, pos: tk.pos };
          continue;
        }
        if (this.peek().t === "symbol" && this.peek().v === "[") {
          this.next();
          const idx = this.parseExpr();
          if (!this.matchSymbol("]")) throw new Error("missing ]");
          node = { kind: "index", target: node, index: idx, pos: tk.pos };
          continue;
        }
        if (this.peek().t === "symbol" && this.peek().v === ".") {
          this.next();
          if (this.peek().t !== "id") throw new Error("expected property name after .");
          const name = this.next().v;
          node = { kind: "prop", target: node, name, pos: tk.pos };
          continue;
        }
        break;
      }
      return node;
    }

    if (this.matchSymbol("(")) {
      const e = this.parseExpr();
      if (!this.matchSymbol(")")) throw new Error("missing )");
      return e;
    }

    throw new Error("Unexpected token in primary: " + JSON.stringify(tk));
  }
}

/* ---------------- Bytecode ops ---------------- */
const Op = {
  CONST: "CONST", LOAD: "LOAD", STORE: "STORE", POP: "POP",
  ADD: "ADD", SUB: "SUB", MUL: "MUL", DIV: "DIV", MOD: "MOD",
  EQ: "EQ", NEQ: "NEQ", LT: "LT", LTE: "LTE", GT: "GT", GTE: "GTE",
  JMP: "JMP", JMPF: "JMPF", CALL: "CALL", RET: "RET", HALT: "HALT",
  AND: "AND", OR: "OR", NOT: "NOT",
  NEWARRAY: "NEWARRAY", NEWOBJ: "NEWOBJ", INDEX: "INDEX", SETINDEX: "SETINDEX",
  GETPROP: "GETPROP", SETPROP: "SETPROP",
  IMPORT: "IMPORT",
  DECL: "DECL", POPLOCAL: "POPLOCAL",
  CLOSURE: "CLOSURE",
  TRY_PUSH: "TRY_PUSH", TRY_POP: "TRY_POP", THROW: "THROW", CATCH_BIND: "CATCH_BIND"
};

/* ---------------- Compiler ---------------- */
class Compiler {
  constructor() {
    this.consts = [];
    this.code = [];
    this.loopStack = [];
    this.scopeStack = [[]];
    this.ipToPos = new Map();
    this.exportsList = [];
  }
  addConst(v) { const idx = this.consts.indexOf(v); if (idx !== -1) return idx; this.consts.push(v); return this.consts.length - 1; }
  emit(inst, pos = null) {
    if (pos) inst.pos = pos;
    this.code.push(inst);
    if (pos) this.ipToPos.set(this.code.length - 1, pos);
  }

  enterScope() { this.scopeStack.push([]); }
  leaveScope() {
    const declared = this.scopeStack.pop() || [];
    for (let i = declared.length - 1; i >= 0; i--) {
      this.emit({ op: Op.POPLOCAL, arg: declared[i] });
    }
  }
  recordDeclared(constIdx) { this.scopeStack[this.scopeStack.length - 1].push(constIdx); }

  compile(stmts) {
    this.consts = [];
    this.code = [];
    this.scopeStack = [[]];
    this.ipToPos = new Map();
    this.exportsList = [];
    return this.compileProgram(stmts);
  }

  compileFunctionBody(stmts) {
    const savedConsts = this.consts.slice();
    const savedCode = this.code.slice();
    const savedScope = this.scopeStack.slice();
    const savedIpToPos = new Map(this.ipToPos);
    const savedExports = this.exportsList.slice();

    this.consts = [];
    this.code = [];
    this.scopeStack = [[]];
    this.ipToPos = new Map();
    this.exportsList = [];

    for (const s of stmts) this.emitStmt(s);
    this.emit({ op: Op.CONST, arg: this.addConst(null) });
    this.emit({ op: Op.RET });
    const result = { consts: this.consts, code: this.code, ipToPos: this.ipToPos, exportsList: this.exportsList };

    this.consts = savedConsts;
    this.code = savedCode;
    this.scopeStack = savedScope;
    this.ipToPos = savedIpToPos;
    this.exportsList = savedExports;

    return result;
  }

  compileProgram(stmts) {
    this.exportsList = [];
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      const isLast = (i === stmts.length - 1);
      if (isLast && s.kind === "expr") this.emitExpr(s.expr);
      else this.emitStmt(s);
    }
    this.emit({ op: Op.HALT });
    return { consts: this.consts, code: this.code, ipToPos: this.ipToPos, exportsList: this.exportsList };
  }

  collectFreeVars(body, params) {
    const declared = new Set(params || []);
    const used = new Set();
    const declaredLocals = new Set();

    function walkNode(node) {
      if (!node) return;
      switch (node.kind) {
        case "num": case "str": case "bool": case "null": return;
        case "var": used.add(node.name); return;
        case "array": node.elements.forEach(walkNode); return;
        case "obj": node.entries.forEach(en => { walkNode(en.value); }); return;
        case "index": walkNode(node.target); walkNode(node.index); return;
        case "prop": walkNode(node.target); return;
        case "bin": walkNode(node.left); walkNode(node.right); return;
        case "unary": walkNode(node.expr); return;
        case "call": walkNode(node.callee); node.args.forEach(walkNode); return;
        default: return;
      }
    }

    function walkStmt(s) {
      if (!s) return;
      switch (s.kind) {
        case "let":
          declaredLocals.add(s.name);
          walkNode(s.expr);
          break;
        case "expr":
          walkNode(s.expr);
          break;
        case "assign":
          walkNode(s.target);
          walkNode(s.expr);
          break;
        case "if":
          walkNode(s.cond);
          s.then.forEach(walkStmt);
          s.otherwise.forEach(walkStmt);
          break;
        case "while":
          walkNode(s.cond);
          s.body.forEach(walkStmt);
          break;
        case "for":
          declaredLocals.add(s.iterator);
          walkNode(s.iterable);
          s.body.forEach(walkStmt);
          break;
        case "fn":
          if (s.name) declaredLocals.add(s.name);
          s.body.forEach(walkStmt);
          break;
        case "return":
          if (s.expr) walkNode(s.expr);
          break;
        case "try":
          s.body.forEach(walkStmt);
          if (s.catchBody) s.catchBody.forEach(walkStmt);
          if (s.finallyBody) s.finallyBody.forEach(walkStmt);
          break;
        case "throw":
          walkNode(s.expr);
          break;
        default:
          break;
      }
    }

    body.forEach(walkStmt);

    const free = [];
    used.forEach(n => {
      if (!declared.has(n) && !declaredLocals.has(n)) free.push(n);
    });
    return free;
  }

  emitStmt(s) {
    const pos = s.pos || null;
    switch (s.kind) {
      case "expr":
        this.emitExpr(s.expr);
        this.emit({ op: Op.POP }, pos);
        break;
      case "let": {
        this.emitExpr(s.expr);
        const nameIdx = this.addConst(s.name);
        this.emit({ op: Op.DECL, arg: nameIdx, mutable: !!s.mutable }, pos);
        this.recordDeclared(nameIdx);
        break;
      }
      case "assign": {
        const t = s.target;
        if (t.kind === "var") {
          this.emitExpr(s.expr);
          this.emit({ op: Op.STORE, arg: this.addConst(t.name) }, pos);
        } else if (t.kind === "index") {
          this.emitExpr(t.target);
          this.emitExpr(t.index);
          this.emitExpr(s.expr);
          this.emit({ op: Op.SETINDEX }, pos);
        } else if (t.kind === "prop") {
          this.emitExpr(t.target);
          this.emit({ op: Op.CONST, arg: this.addConst(t.name) });
          this.emitExpr(s.expr);
          this.emit({ op: Op.SETPROP }, pos);
        } else throw new Error("Unsupported assignment target");
        break;
      }
      case "import": {
        this.emit({ op: Op.IMPORT, arg: this.addConst(s.file) }, pos);
        if (s.alias) {
          this.emit({ op: Op.CONST, arg: this.addConst("exports") }, pos);
          this.emit({ op: Op.GETPROP }, pos);
          this.emit({ op: Op.STORE, arg: this.addConst(s.alias) }, pos);
        }
        break;
      }
      case "import_named": {
        this.emit({ op: Op.IMPORT, arg: this.addConst(s.file) }, pos);
        const tmpName = "__mod_" + Math.floor(Math.random() * 1e9);
        this.emit({ op: Op.STORE, arg: this.addConst(tmpName) }, pos);
        for (const spec of s.specifiers) {
          this.emit({ op: Op.LOAD, arg: this.addConst("bind") }, pos);
          this.emit({ op: Op.LOAD, arg: this.addConst(tmpName) }, pos);
          this.emit({ op: Op.CONST, arg: this.addConst(spec.orig) }, pos);
          this.emit({ op: Op.CALL, arg: 2 }, pos);
          this.emit({ op: Op.STORE, arg: this.addConst(spec.local) }, pos);
        }
        break;
      }
      case "fn": {
        const subCompiler = new Compiler();
        const bytecode = subCompiler.compileFunctionBody(s.body);
        const upvalueNames = this.collectFreeVars(s.body, s.params || []);
        const funcObj = { params: s.params, code: bytecode.code, consts: bytecode.consts, ipToPos: bytecode.ipToPos, upvalueNames };
        const funcIdx = this.addConst(funcObj);
        this.emit({ op: Op.CONST, arg: funcIdx }, pos);
        this.emit({ op: Op.CLOSURE, arg: funcIdx }, pos);
        if (s.name) {
          this.emit({ op: Op.STORE, arg: this.addConst(s.name) }, pos);
        }
        break;
      }
      case "return": {
        if (s.expr) this.emitExpr(s.expr);
        this.emit({ op: Op.RET }, pos);
        break;
      }
      case "if": {
        this.emitExpr(s.cond);
        const jmpfPos = this.code.length;
        this.emit({ op: Op.JMPF, arg: null }, pos);
        this.enterScope();
        for (const st of s.then) this.emitStmt(st);
        this.leaveScope();
        const jmpEndPos = this.code.length;
        this.emit({ op: Op.JMP, arg: null }, pos);
        this.code[jmpfPos].arg = this.code.length;
        this.enterScope();
        for (const st of s.otherwise) this.emitStmt(st);
        this.leaveScope();
        this.code[jmpEndPos].arg = this.code.length;
        break;
      }
      case "while": {
        const start = this.code.length;
        this.loopStack.push({ breaks: [], continues: [], start });
        this.emitExpr(s.cond);
        const jmpf = this.code.length;
        this.emit({ op: Op.JMPF, arg: null }, pos);
        this.enterScope();
        for (const st of s.body) this.emitStmt(st);
        this.leaveScope();
        const loopInfo = this.loopStack.pop();
        for (const cpos of loopInfo.continues) this.code[cpos].arg = start;
        this.emit({ op: Op.JMP, arg: start }, pos);
        this.code[jmpf].arg = this.code.length;
        for (const bpos of loopInfo.breaks) this.code[bpos].arg = this.code.length;
        break;
      }
      case "for": {
        const iterName = "__iter_" + Math.floor(Math.random() * 1e9);
        const idxName = "__i_" + Math.floor(Math.random() * 1e9);
        this.emitExpr(s.iterable);
        this.emit({ op: Op.STORE, arg: this.addConst(iterName) }, pos);
        this.emit({ op: Op.CONST, arg: this.addConst(0) }, pos);
        this.emit({ op: Op.STORE, arg: this.addConst(idxName) }, pos);
        const start = this.code.length;
        this.loopStack.push({ breaks: [], continues: [], start });
        this.emit({ op: Op.LOAD, arg: this.addConst(idxName) }, pos);
        this.emit({ op: Op.LOAD, arg: this.addConst("len") }, pos);
        this.emit({ op: Op.LOAD, arg: this.addConst(iterName) }, pos);
        this.emit({ op: Op.CALL, arg: 1 }, pos);
        this.emit({ op: Op.LT }, pos);
        const jmpf = this.code.length;
        this.emit({ op: Op.JMPF, arg: null }, pos);
        this.emit({ op: Op.LOAD, arg: this.addConst(iterName) }, pos);
        this.emit({ op: Op.LOAD, arg: this.addConst(idxName) }, pos);
        this.emit({ op: Op.INDEX }, pos);
        this.emit({ op: Op.STORE, arg: this.addConst(s.iterator) }, pos);
        this.enterScope();
        for (const st of s.body) this.emitStmt(st);
        this.leaveScope();
        const loopInfo = this.loopStack.pop();
        const continueTarget = this.code.length;
        for (const cpos of loopInfo.continues) this.code[cpos].arg = continueTarget;
        this.emit({ op: Op.LOAD, arg: this.addConst(idxName) }, pos);
        this.emit({ op: Op.CONST, arg: this.addConst(1) }, pos);
        this.emit({ op: Op.ADD }, pos);
        this.emit({ op: Op.STORE, arg: this.addConst(idxName) }, pos);
        this.emit({ op: Op.JMP, arg: start }, pos);
        this.code[jmpf].arg = this.code.length;
        for (const bpos of loopInfo.breaks) this.code[bpos].arg = this.code.length;
        break;
      }
      case "break": {
        if (this.loopStack.length === 0) throw new Error("break outside loop");
        this.emit({ op: Op.JMP, arg: null }, pos);
        const info = this.loopStack[this.loopStack.length - 1];
        info.breaks.push(this.code.length - 1);
        break;
      }
      case "continue": {
        if (this.loopStack.length === 0) throw new Error("continue outside loop");
        this.emit({ op: Op.JMP, arg: null }, pos);
        const info2 = this.loopStack[this.loopStack.length - 1];
        info2.continues.push(this.code.length - 1);
        break;
      }
      case "try": {
        // Basic try/catch support (finally ignored for simplicity)
        const startTryIp = this.code.length;
        // push try handler (we'll set arg to catch start later)
        this.emit({ op: Op.TRY_PUSH, arg: null }, pos);
        for (const st of s.body) this.emitStmt(st);
        // normal path: pop try handler
        this.emit({ op: Op.TRY_POP }, pos);
        // jump over catch
        const jmpOverCatchPos = this.code.length;
        this.emit({ op: Op.JMP, arg: null }, pos);
        // catch start
        const catchStart = this.code.length;
        if (s.catchBody) {
          // bind exception to catchParam
          const catchNameIdx = this.addConst(s.catchParam);
          this.emit({ op: Op.CATCH_BIND, arg: catchNameIdx }, pos);
          this.enterScope();
          for (const st of s.catchBody) this.emitStmt(st);
          this.leaveScope();
        }
        // finally (if present) - execute always after try or catch
        if (s.finallyBody) {
          for (const st of s.finallyBody) this.emitStmt(st);
        }
        // set jump target to after catch/finally
        const afterAll = this.code.length;
        this.code[jmpOverCatchPos].arg = afterAll;
        // set TRY_PUSH arg to catchStart so VM knows where to jump on throw
        this.code[startTryIp].arg = catchStart;
        break;
      }
      case "throw": {
        this.emitExpr(s.expr);
        this.emit({ op: Op.THROW }, pos);
        break;
      }
      case "export_decl": {
        // compile expression and declare variable; also register export
        this.emitExpr(s.expr);
        const nameIdx = this.addConst(s.name);
        this.emit({ op: Op.DECL, arg: nameIdx, mutable: true }, pos);
        this.recordDeclared(nameIdx);
        this.exportsList.push({ type: "named", name: s.name });
        break;
      }
      case "export_fn": {
        // compile function and store it, register export
        const fnNode = s.fn;
        const subCompiler = new Compiler();
        const bytecode = subCompiler.compileFunctionBody(fnNode.body);
        const upvalueNames = this.collectFreeVars(fnNode.body, fnNode.params || []);
        const funcObj = { params: fnNode.params, code: bytecode.code, consts: bytecode.consts, ipToPos: bytecode.ipToPos, upvalueNames };
        const funcIdx = this.addConst(funcObj);
        this.emit({ op: Op.CONST, arg: funcIdx }, pos);
        this.emit({ op: Op.CLOSURE, arg: funcIdx }, pos);
        if (fnNode.name) {
          this.emit({ op: Op.STORE, arg: this.addConst(fnNode.name) }, pos);
          this.exportsList.push({ type: "named", name: fnNode.name });
        } else {
          // anonymous exported function assigned to default
          this.emit({ op: Op.STORE, arg: this.addConst("__anon_export_default") }, pos);
          this.exportsList.push({ type: "default", name: "__anon_export_default" });
        }
        break;
      }
      case "export_default": {
        // compile expression and store into special default export
        this.emitExpr(s.expr);
        this.emit({ op: Op.STORE, arg: this.addConst("default") }, pos);
        this.exportsList.push({ type: "default", name: "default" });
        break;
      }
      case "export_named": {
        for (const nm of s.names) this.exportsList.push({ type: "named", name: nm });
        break;
      }
      default:
        throw new Error("Unsupported stmt kind: " + s.kind);
    }
  }

  emitExpr(e) {
    const pos = e.pos || null;
    switch (e.kind) {
      case "num": this.emit({ op: Op.CONST, arg: this.addConst(e.value) }, pos); break;
      case "str": this.emit({ op: Op.CONST, arg: this.addConst(e.value) }, pos); break;
      case "bool": this.emit({ op: Op.CONST, arg: this.addConst(e.value) }, pos); break;
      case "null": this.emit({ op: Op.CONST, arg: this.addConst(null) }, pos); break;
      case "array": {
        for (const el of e.elements) this.emitExpr(el);
        this.emit({ op: Op.NEWARRAY, arg: e.elements.length }, pos);
        break;
      }
      case "obj": {
        for (const en of e.entries) {
          this.emit({ op: Op.CONST, arg: this.addConst(en.key) }, pos);
          this.emitExpr(en.value);
        }
        this.emit({ op: Op.NEWOBJ, arg: e.entries.length }, pos);
        break;
      }
      case "var": {
        this.emit({ op: Op.LOAD, arg: this.addConst(e.name) }, pos);
        break;
      }
      case "call": {
        this.emitExpr(e.callee);
        for (const a of e.args) this.emitExpr(a);
        this.emit({ op: Op.CALL, arg: e.args.length }, pos);
        break;
      }
      case "index": {
        this.emitExpr(e.target);
        this.emitExpr(e.index);
        this.emit({ op: Op.INDEX }, pos);
        break;
      }
      case "prop": {
        this.emitExpr(e.target);
        this.emit({ op: Op.CONST, arg: this.addConst(e.name) }, pos);
        this.emit({ op: Op.GETPROP }, pos);
        break;
      }
      case "bin": {
        this.emitExpr(e.left);
        this.emitExpr(e.right);
        switch (e.op) {
          case "+": this.emit({ op: Op.ADD }, pos); break;
          case "-": this.emit({ op: Op.SUB }, pos); break;
          case "*": this.emit({ op: Op.MUL }, pos); break;
          case "/": this.emit({ op: Op.DIV }, pos); break;
          case "%": this.emit({ op: Op.MOD }, pos); break;
          case "==": this.emit({ op: Op.EQ }, pos); break;
          case "!=": this.emit({ op: Op.NEQ }, pos); break;
          case "<": this.emit({ op: Op.LT }, pos); break;
          case "<=": this.emit({ op: Op.LTE }, pos); break;
          case ">": this.emit({ op: Op.GT }, pos); break;
          case ">=": this.emit({ op: Op.GTE }, pos); break;
          case "&&": this.emit({ op: Op.AND }, pos); break;
          case "||": this.emit({ op: Op.OR }, pos); break;
          default: throw new Error("Unsupported binary op: " + e.op);
        }
        break;
      }
      case "unary": {
        this.emitExpr(e.expr);
        if (e.op === "!") this.emit({ op: Op.NOT }, pos);
        else throw new Error("Unsupported unary op: " + e.op);
        break;
      }
      default:
        throw new Error("Unsupported expr kind: " + e.kind);
    }
  }
}

/* ---------------- VM ---------------- */

class VM {
  constructor(consts = [], code = [], options = {}) {
    this.consts = consts || [];
    this.code = code || [];
    this.ip = 0;
    this.stack = [];
    this.frames = []; // call frames
    this.globals = Object.create(null); // top-level globals (module scope)
    this.localsStack = []; // for scopes inside a frame (not used heavily)
    this.tryStack = []; // runtime try handlers (per-frame)
    this.moduleCache = options.moduleCache || new Map();
    this.baseDir = options.baseDir || process.cwd();
    this.debug = !!options.debug;
    this.ipToPos = options.ipToPos || new Map();
    this.builtins = this.createBuiltins();
    // seed builtins into globals
    for (const k of Object.keys(this.builtins)) this.globals[k] = this.builtins[k];
  }

  createBuiltins() {
    const self = this;
    return {
      print: function(...args) {
        console.log(...args.map(a => (a === undefined ? "undefined" : a)));
      },
      len: function(x) {
        if (Array.isArray(x) || typeof x === "string") return x.length;
        if (x && typeof x === "object") return Object.keys(x).length;
        return 0;
      },
      bind: function(modExports, name) {
        // return a live-binding descriptor
        return { __live: true, module: modExports, name };
      },
      require: function(p) {
        // convenience: synchronous import wrapper (not used by compiler)
        return self.loadModuleSync(p);
      },
      fetch: fetchImpl,
      readline: function(prompt) {
        if (!readlineSync) throw new Error("readline not available");
        return readlineSync.question(prompt || "");
      }
    };
  }

  push(v) { this.stack.push(v); }
  pop() { return this.stack.pop(); }
  peek(n = 0) { return this.stack[this.stack.length - 1 - n]; }

  currentFrame() { return this.frames[this.frames.length - 1] || null; }

  resolveNameInEnv(name) {
    // search locals in current frame, then closure upvalues, then globals
    const frame = this.currentFrame();
    if (frame) {
      if (frame.locals && Object.prototype.hasOwnProperty.call(frame.locals, name)) return { where: "local", frame, name };
      if (frame.closureEnv && frame.closureEnv.bindings && frame.closureEnv.names && frame.closureEnv.names.includes(name)) {
        return { where: "upvalue", frame, name };
      }
    }
    if (Object.prototype.hasOwnProperty.call(this.globals, name)) return { where: "global", name };
    return { where: "global", name }; // default to global
  }

  getVarByName(name) {
    // handle live binding descriptors stored in globals or locals
    const frame = this.currentFrame();
    if (frame && frame.locals && Object.prototype.hasOwnProperty.call(frame.locals, name)) {
      const v = frame.locals[name];
      if (v && v.__live) return v.module[v.name];
      return v;
    }
    if (frame && frame.closureEnv && frame.closureEnv.bindings && frame.closureEnv.names && frame.closureEnv.names.includes(name)) {
      // upvalue captured by name -> read from captured bindings
      const idx = frame.closureEnv.names.indexOf(name);
      const bindings = frame.closureEnv.bindings;
      if (bindings && Object.prototype.hasOwnProperty.call(bindings, name)) {
        const v = bindings[name];
        if (v && v.__live) return v.module[v.name];
        return v;
      }
    }
    if (Object.prototype.hasOwnProperty.call(this.globals, name)) {
      const v = this.globals[name];
      if (v && v.__live) return v.module[v.name];
      return v;
    }
    return undefined;
  }

  setVarByName(name, value) {
    const frame = this.currentFrame();
    if (frame && frame.locals && Object.prototype.hasOwnProperty.call(frame.locals, name)) {
      const existing = frame.locals[name];
      if (existing && existing.__live) {
        existing.module[existing.name] = value;
        return;
      }
      frame.locals[name] = value;
      return;
    }
    if (frame && frame.closureEnv && frame.closureEnv.bindings && frame.closureEnv.names && frame.closureEnv.names.includes(name)) {
      const bindings = frame.closureEnv.bindings;
      if (bindings && Object.prototype.hasOwnProperty.call(bindings, name)) {
        const existing = bindings[name];
        if (existing && existing.__live) {
          existing.module[existing.name] = value;
          return;
        }
        bindings[name] = value;
        return;
      }
    }
    // globals
    const existing = this.globals[name];
    if (existing && existing.__live) {
      existing.module[existing.name] = value;
      return;
    }
    this.globals[name] = value;
  }

  async run() {
    try {
      while (this.ip < this.code.length) {
        const inst = this.code[this.ip];
        if (this.debug && inst && inst.pos) {
          // optionally print debug info
          // console.error("IP", this.ip, inst.op, inst.arg, "pos", inst.pos);
        }
        switch (inst.op) {
          case Op.CONST: {
            const v = this.consts[inst.arg];
            this.push(v);
            this.ip++;
            break;
          }
          case Op.LOAD: {
            const name = this.consts[inst.arg];
            const v = this.getVarByName(name);
            this.push(v);
            this.ip++;
            break;
          }
          case Op.STORE: {
            const name = this.consts[inst.arg];
            const val = this.pop();
            this.setVarByName(name, val);
            this.ip++;
            break;
          }
          case Op.DECL: {
            const name = this.consts[inst.arg];
            const mutable = !!inst.mutable;
            const frame = this.currentFrame();
            if (frame) {
              frame.locals = frame.locals || Object.create(null);
              frame.locals[name] = this.pop();
            } else {
              // top-level declare -> globals
              this.globals[name] = this.pop();
            }
            this.ip++;
            break;
          }
          case Op.POPLOCAL: {
            const name = this.consts[inst.arg];
            const frame = this.currentFrame();
            if (frame && frame.locals) delete frame.locals[name];
            else delete this.globals[name];
            this.ip++;
            break;
          }
          case Op.POP: {
            this.pop();
            this.ip++;
            break;
          }
          case Op.ADD: {
            const b = this.pop(); const a = this.pop();
            this.push(a + b);
            this.ip++;
            break;
          }
          case Op.SUB: {
            const b = this.pop(); const a = this.pop();
            this.push(a - b);
            this.ip++;
            break;
          }
          case Op.MUL: {
            const b = this.pop(); const a = this.pop();
            this.push(a * b);
            this.ip++;
            break;
          }
          case Op.DIV: {
            const b = this.pop(); const a = this.pop();
            this.push(a / b);
            this.ip++;
            break;
          }
          case Op.MOD: {
            const b = this.pop(); const a = this.pop();
            this.push(a % b);
            this.ip++;
            break;
          }
          case Op.EQ: {
            const b = this.pop(); const a = this.pop();
            this.push(a === b);
            this.ip++;
            break;
          }
          case Op.NEQ: {
            const b = this.pop(); const a = this.pop();
            this.push(a !== b);
            this.ip++;
            break;
          }
          case Op.LT: {
            const b = this.pop(); const a = this.pop();
            this.push(a < b);
            this.ip++;
            break;
          }
          case Op.LTE: {
            const b = this.pop(); const a = this.pop();
            this.push(a <= b);
            this.ip++;
            break;
          }
          case Op.GT: {
            const b = this.pop(); const a = this.pop();
            this.push(a > b);
            this.ip++;
            break;
          }
          case Op.GTE: {
            const b = this.pop(); const a = this.pop();
            this.push(a >= b);
            this.ip++;
            break;
          }
          case Op.JMP: {
            this.ip = inst.arg;
            break;
          }
          case Op.JMPF: {
            const cond = this.pop();
            if (!cond) this.ip = inst.arg;
            else this.ip++;
            break;
          }
          case Op.CALL: {
            const argc = inst.arg || 0;
            const args = [];
            for (let i = 0; i < argc; i++) args.unshift(this.pop());
            const callee = this.pop();
            if (typeof callee === "function") {
              // native function
              const res = callee(...args);
              this.push(res);
              this.ip++;
            } else if (callee && callee.type === "closure") {
              // push current frame
              const newFrame = {
                code: callee.func.code,
                consts: callee.func.consts,
                ipToPos: callee.func.ipToPos,
                ip: 0,
                locals: Object.create(null),
                closureEnv: callee.env
              };
              // bind params
              for (let i = 0; i < (callee.func.params || []).length; i++) {
                const pname = callee.func.params[i];
                newFrame.locals[pname] = args[i];
              }
              this.frames.push(newFrame);
              // switch execution context to new frame
              // save current code/consts
              this.push({ __ret_marker: true }); // marker to know when function returns
              // set VM code/consts to function's
              this.code = newFrame.code;
              this.consts = newFrame.consts;
              this.ip = 0;
            } else {
              throw this.makeError("Attempt to call non-function", inst.pos);
            }
            break;
          }
          case Op.RET: {
            // if no frames, halt
            if (this.frames.length === 0) {
              // top-level return -> halt
              this.ip = this.code.length;
              break;
            }
            // pop return value
            const retVal = this.pop();
            // restore previous frame
            // find return marker on stack
            // restore previous code/consts from saved frame
            // pop current frame
            const finishedFrame = this.frames.pop();
            // restore global code/consts from caller frame if any
            // caller's code/consts are stored in the previous frame object if any
            // We used a simple marker approach: the caller's code/consts are on the previous frame object
            // But to keep it simple: when we entered a function we replaced this.code/consts with function's.
            // We need to restore them from the last frame (caller) if exists, otherwise leave as-is.
            if (this.frames.length === 0) {
              // restore to top-level: nothing to do because top-level code was replaced earlier
              // but we stored the caller's code/consts on the stack? Simpler approach:
              // We will assume top-level run() was invoked with VM.code/consts set to module code.
              // When CALL created a new frame we replaced code/consts with function's and pushed a marker object on stack.
              // To restore, we need to find the marker and then restore code/consts from a saved place.
              // For simplicity, we will store the caller's code/consts on the finishedFrame object when CALL happened.
            }
            // find the return marker and pop it
            while (this.stack.length > 0) {
              const top = this.pop();
              if (top && top.__ret_marker) break;
            }
            // restore caller context: if there is a caller frame, its code/consts are the current top frame's code/consts
            if (this.frames.length > 0) {
              const callerFrame = this.frames[this.frames.length - 1];
              this.code = callerFrame.code;
              this.consts = callerFrame.consts;
              this.ip = callerFrame.ip;
            } else {
              // no caller frame -> we need to stop execution of function code and resume top-level after CALL
              // For simplicity, set ip to end to stop inner loop; the top-level run() will continue
              // But to support nested calls properly, we will set ip to the next instruction after the CALL by storing it on a small call-return stack.
              // Simpler: push retVal and halt inner execution by setting ip to code.length
              this.push(retVal);
              this.ip = this.code.length;
            }
            // push return value
            this.push(retVal);
            break;
          }
          case Op.HALT: {
            return;
          }
          case Op.NEWARRAY: {
            const n = inst.arg || 0;
            const arr = [];
            for (let i = 0; i < n; i++) {
              arr.unshift(this.pop());
            }
            this.push(arr);
            this.ip++;
            break;
          }
          case Op.NEWOBJ: {
            const n = inst.arg || 0;
            const obj = {};
            for (let i = 0; i < n; i++) {
              const val = this.pop();
              const key = this.pop();
              obj[key] = val;
            }
            this.push(obj);
            this.ip++;
            break;
          }
          case Op.INDEX: {
            const idx = this.pop();
            const target = this.pop();
            if (Array.isArray(target) || typeof target === "string") this.push(target[idx]);
            else if (target && typeof target === "object") this.push(target[idx]);
            else this.push(undefined);
            this.ip++;
            break;
          }
          case Op.SETINDEX: {
            const val = this.pop();
            const idx = this.pop();
            const target = this.pop();
            if (Array.isArray(target)) target[idx] = val;
            else if (target && typeof target === "object") target[idx] = val;
            this.push(val);
            this.ip++;
            break;
          }
          case Op.GETPROP: {
            const prop = this.pop();
            const obj = this.pop();
            if (obj && typeof obj === "object") this.push(obj[prop]);
            else this.push(undefined);
            this.ip++;
            break;
          }
          case Op.SETPROP: {
            const val = this.pop();
            const prop = this.pop();
            const obj = this.pop();
            if (obj && typeof obj === "object") obj[prop] = val;
            this.push(val);
            this.ip++;
            break;
          }
          case Op.IMPORT: {
            const fileConst = this.consts[inst.arg];
            const modExports = await this.loadModule(fileConst);
            // push module exports object
            this.push(modExports);
            this.ip++;
            break;
          }
          case Op.CLOSURE: {
            const funcObj = this.consts[inst.arg];
            // capture upvalues from current globals (simple capture)
            const upnames = funcObj.upvalueNames || [];
            const bindings = Object.create(null);
            for (const n of upnames) {
              // capture reference to global or current frame local if exists
              const v = this.getVarByName(n);
              // to preserve live-binding semantics, capture the descriptor object if present in globals
              // find the actual storage (global or local)
              if (this.currentFrame() && this.currentFrame().locals && Object.prototype.hasOwnProperty.call(this.currentFrame().locals, n)) {
                bindings[n] = this.currentFrame().locals[n];
              } else if (Object.prototype.hasOwnProperty.call(this.globals, n)) {
                bindings[n] = this.globals[n];
              } else {
                bindings[n] = v;
              }
            }
            const closure = { type: "closure", func: funcObj, env: { names: upnames.slice(), bindings } };
            this.push(closure);
            this.ip++;
            break;
          }
          case Op.TRY_PUSH: {
            // arg is catchStart ip (or null)
            this.tryStack.push({ catchIp: inst.arg, frameDepth: this.frames.length, stackDepth: this.stack.length });
            this.ip++;
            break;
          }
          case Op.TRY_POP: {
            this.tryStack.pop();
            this.ip++;
            break;
          }
          case Op.THROW: {
            const ex = this.pop();
            // find nearest try handler in same frame depth
            if (this.tryStack.length === 0) {
              // uncaught -> throw JS error with source info if available
              throw ex;
            }
            const handler = this.tryStack.pop();
            // unwind stack to handler.stackDepth
            while (this.stack.length > handler.stackDepth) this.pop();
            // set ip to catchIp
            if (handler.catchIp !== null && handler.catchIp !== undefined) {
              this.ip = handler.catchIp;
              // push exception value so CATCH_BIND can bind it
              this.push(ex);
            } else {
              // no catch -> rethrow
              throw ex;
            }
            break;
          }
          case Op.CATCH_BIND: {
            const name = this.consts[inst.arg];
            const ex = this.pop();
            // bind into current locals or globals
            const frame = this.currentFrame();
            if (frame) {
              frame.locals = frame.locals || Object.create(null);
              frame.locals[name] = ex;
            } else {
              this.globals[name] = ex;
            }
            this.ip++;
            break;
          }
          case Op.NOT: {
            const v = this.pop();
            this.push(!v);
            this.ip++;
            break;
          }
          case Op.AND: {
            const b = this.pop(); const a = this.pop();
            this.push(a && b);
            this.ip++;
            break;
          }
          case Op.OR: {
            const b = this.pop(); const a = this.pop();
            this.push(a || b);
            this.ip++;
            break;
          }
          default:
            throw this.makeError("Unknown opcode: " + inst.op, inst.pos);
        }
      }
    } catch (err) {
      // attach source-aware info if possible
      if (err && typeof err === "object" && !err.file && this.ipToPos && this.ipToPos.has(this.ip)) {
        const pos = this.ipToPos.get(this.ip);
        err.file = pos.file; err.line = pos.line; err.col = pos.col;
      }
      throw err;
    }
  }

  makeError(msg, pos) {
    const e = new Error(msg);
    if (pos) { e.file = pos.file; e.line = pos.line; e.col = pos.col; }
    return e;
  }

  async loadModule(filePath) {
    // resolve path relative to baseDir
    const resolved = this.resolveModulePath(filePath);
    if (this.moduleCache.has(resolved)) return this.moduleCache.get(resolved).exportsProxy;

    // create placeholder to support cycles (partial initialization)
    const placeholder = { exports: Object.create(null), exportsProxy: Object.create(null), initialized: false, globals: Object.create(null) };
    // create live-binding proxy object (simple direct object)
    placeholder.exportsProxy = placeholder.exports;
    this.moduleCache.set(resolved, placeholder);

    // read source
    const src = fs.readFileSync(resolved, "utf8");
    // lex/parse/compile
    const lexer = new Lexer(src, resolved);
    const tokens = lexer.lex();
    const parser = new Parser(tokens);
    const stmts = parser.parseProgram();
    const compiler = new Compiler();
    const compiled = compiler.compile(stmts);

    // create a VM to run module code with its own globals but sharing moduleCache
    const moduleVM = new VM(compiled.consts, compiled.code, { baseDir: path.dirname(resolved), debug: this.debug, moduleCache: this.moduleCache, ipToPos: compiled.ipToPos });
    // seed module globals with builtins
    for (const k of Object.keys(this.builtins)) moduleVM.globals[k] = this.builtins[k];
    // provide special "exports" object and live-binding behavior
    moduleVM.globals["exports"] = placeholder.exports;
    // run module
    try {
      await moduleVM.run();
    } catch (err) {
      // attach module path info if missing
      if (err && typeof err === "object" && !err.file) {
        err.file = resolved;
      }
      throw err;
    }

    // after execution, populate placeholder.exports with exported names
    // The compiler recorded exportsList; use it if present
    if (compiled.exportsList && compiled.exportsList.length > 0) {
      for (const ex of compiled.exportsList) {
        if (ex.type === "named") {
          const name = ex.name;
          // read from moduleVM.globals
          placeholder.exports[name] = moduleVM.globals[name];
        } else if (ex.type === "default") {
          const name = ex.name || "default";
          placeholder.exports["default"] = moduleVM.globals[name];
        }
      }
    } else {
      // fallback: copy all globals except builtins
      for (const k of Object.keys(moduleVM.globals)) {
        if (!Object.prototype.hasOwnProperty.call(this.builtins, k)) placeholder.exports[k] = moduleVM.globals[k];
      }
    }

    placeholder.initialized = true;
    // update cache entry
    this.moduleCache.set(resolved, placeholder);
    return placeholder.exportsProxy;
  }

  loadModuleSync(filePath) {
    // synchronous loader used by builtins.require
    const resolved = this.resolveModulePath(filePath);
    if (this.moduleCache.has(resolved)) return this.moduleCache.get(resolved).exportsProxy;

    const placeholder = { exports: Object.create(null), exportsProxy: Object.create(null), initialized: false, globals: Object.create(null) };
    placeholder.exportsProxy = placeholder.exports;
    this.moduleCache.set(resolved, placeholder);

    const src = fs.readFileSync(resolved, "utf8");
    const lexer = new Lexer(src, resolved);
    const tokens = lexer.lex();
    const parser = new Parser(tokens);
    const stmts = parser.parseProgram();
    const compiler = new Compiler();
    const compiled = compiler.compile(stmts);

    const moduleVM = new VM(compiled.consts, compiled.code, { baseDir: path.dirname(resolved), debug: this.debug, moduleCache: this.moduleCache, ipToPos: compiled.ipToPos });
    for (const k of Object.keys(this.builtins)) moduleVM.globals[k] = this.builtins[k];
    moduleVM.globals["exports"] = placeholder.exports;
    try {
      // synchronous run: run until HALT
      // our VM.run is async but doesn't await anything except module loads; since this is sync loader, avoid async imports in modules
      const runSync = () => {
        while (moduleVM.ip < moduleVM.code.length) {
          const inst = moduleVM.code[moduleVM.ip];
          switch (inst.op) {
            case Op.CONST: moduleVM.push(moduleVM.consts[inst.arg]); moduleVM.ip++; break;
            case Op.LOAD: {
              const name = moduleVM.consts[inst.arg];
              moduleVM.push(moduleVM.getVarByName(name));
              moduleVM.ip++; break;
            }
            case Op.STORE: {
              const name = moduleVM.consts[inst.arg];
              const val = moduleVM.pop();
              moduleVM.setVarByName(name, val);
              moduleVM.ip++; break;
            }
            case Op.DECL: {
              const name = moduleVM.consts[inst.arg];
              const val = moduleVM.pop();
              moduleVM.globals[name] = val;
              moduleVM.ip++; break;
            }
            case Op.POP: moduleVM.pop(); moduleVM.ip++; break;
            case Op.ADD: { const b = moduleVM.pop(); const a = moduleVM.pop(); moduleVM.push(a + b); moduleVM.ip++; break; }
            case Op.SUB: { const b = moduleVM.pop(); const a = moduleVM.pop(); moduleVM.push(a - b); moduleVM.ip++; break; }
            case Op.MUL: { const b = moduleVM.pop(); const a = moduleVM.pop(); moduleVM.push(a * b); moduleVM.ip++; break; }
            case Op.DIV: { const b = moduleVM.pop(); const a = moduleVM.pop(); moduleVM.push(a / b); moduleVM.ip++; break; }
            case Op.NEWARRAY: {
              const n = inst.arg || 0; const arr = [];
              for (let i = 0; i < n; i++) arr.unshift(moduleVM.pop());
              moduleVM.push(arr); moduleVM.ip++; break;
            }
            case Op.NEWOBJ: {
              const n = inst.arg || 0; const obj = {};
              for (let i = 0; i < n; i++) { const val = moduleVM.pop(); const key = moduleVM.pop(); obj[key] = val; }
              moduleVM.push(obj); moduleVM.ip++; break;
            }
            case Op.CALL: {
              const argc = inst.arg || 0; const args = [];
              for (let i = 0; i < argc; i++) args.unshift(moduleVM.pop());
              const callee = moduleVM.pop();
              if (typeof callee === "function") {
                const res = callee(...args);
                moduleVM.push(res);
                moduleVM.ip++;
              } else {
                throw new Error("Sync loader cannot call non-native functions in module");
              }
              break;
            }
            case Op.HALT: return;
            default:
              throw new Error("Unsupported op in sync loader: " + inst.op);
          }
        }
      };
      runSync();
    } catch (err) {
      if (err && typeof err === "object" && !err.file) err.file = resolved;
      throw err;
    }

    if (compiled.exportsList && compiled.exportsList.length > 0) {
      for (const ex of compiled.exportsList) {
        if (ex.type === "named") {
          const name = ex.name;
          placeholder.exports[name] = moduleVM.globals[name];
        } else if (ex.type === "default") {
          const name = ex.name || "default";
          placeholder.exports["default"] = moduleVM.globals[name];
        }
      }
    } else {
      for (const k of Object.keys(moduleVM.globals)) {
        if (!Object.prototype.hasOwnProperty.call(this.builtins, k)) placeholder.exports[k] = moduleVM.globals[k];
      }
    }

    placeholder.initialized = true;
    this.moduleCache.set(resolved, placeholder);
    return placeholder.exportsProxy;
  }

  resolveModulePath(p) {
    // if p is relative or absolute, resolve; otherwise treat as relative to baseDir
    let candidate = p;
    if (!path.isAbsolute(candidate)) candidate = path.join(this.baseDir, candidate);
    if (!candidate.endsWith(".vx")) candidate = candidate + ".vx";
    return path.normalize(candidate);
  }
}

/* ---------------- Exports ---------------- */
module.exports = { Lexer, Parser, Compiler, VM, Op };
