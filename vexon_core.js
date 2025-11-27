"use strict";
/*
  vexon_core.js — Full Vexon core with extended stdlib

  Features added / integrated:
  - fn <name>(...) { ... } support (parser + compiler)
  - VM call stack / frames for user functions (locals + returns)
  - input() builtin (readline-sync fallback)
  - import "file.vx" handled in VM (with caching)
  - File I/O: read, write, append, exists, delete, list, mkdir, cwd
  - JSON: json_encode, json_decode
  - Math library: math.sin, math.cos, math.sqrt, math.abs, math.pow
  - Timers: sleep(ms) using Atomics.wait (sync sleep)
  - HTTP client: http_get(url), http_post(url, data) (uses global fetch or node-fetch)
  - Process execution: exec(cmd) (execSync)
  - toString(obj) global helper
  - json, len, keys, range, push, pop, print, input builtins
  - String helpers: split, indexOf, substring, trim, toLower, toUpper, startsWith, endsWith, replace
  - Number helpers: number, parseInt, parseFloat, isNaN
  - Math rounding: round, floor, ceil
  - IO helpers: read_json, write_json, join_path
  - Process helpers: env, set_env, argv
  - Global setters/getters: global_set, global_get
  - VM.run() is async to support async builtins (http)
  - Optional debug tracing via options.debug
*/

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

// Optional readline-sync for nicer input()
let readlineSync = null;
try { readlineSync = require("readline-sync"); } catch (e) { readlineSync = null; }

// node-fetch fallback for older Node versions if fetch not present
let fetchImpl = globalThis.fetch;
if (!fetchImpl) {
  try {
    fetchImpl = require("node-fetch");
  } catch (e) {
    fetchImpl = null;
  }
}

/* ---------------- Lexer ---------------- */
function isAlpha(c) { return /[A-Za-z_]/.test(c); }
function isDigit(c) { return /[0-9]/.test(c); }

class Lexer {
  constructor(src) { this.src = src; this.i = 0; }
  peek() { return this.src[this.i] ?? "\0"; }
  next() { return this.src[this.i++] ?? "\0"; }
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
        out.push({ t: "symbol", v: c + "=" }); this.next(); this.next(); continue;
      }
      if (c === "&" && this.src[this.i + 1] === "&") { out.push({ t: "symbol", v: "&&" }); this.next(); this.next(); continue; }
      if (c === "|" && this.src[this.i + 1] === "|") { out.push({ t: "symbol", v: "||" }); this.next(); this.next(); continue; }

      if (isDigit(c)) {
        let num = "";
        while (!this.eof() && (isDigit(this.peek()) || this.peek() === ".")) num += this.next();
        out.push({ t: "number", v: num }); continue;
      }

      if (c === '"' || c === "'") {
        const q = this.next(); let s = "";
        while (!this.eof() && this.peek() !== q) {
          let ch = this.next();
          if (ch === "\\") {
            const n = this.next();
            if (n === "n") s += "\n"; else if (n === "t") s += "\t"; else s += n;
          } else s += ch;
        }
        if (this.peek() === q) this.next();
        out.push({ t: "string", v: s }); continue;
      }

      if (isAlpha(c)) {
        let id = "";
        while (!this.eof() && /[A-Za-z0-9_]/.test(this.peek())) id += this.next();
        if (["true","false","null","in","for","let","fn","return","if","else","while","break","continue","import","as"].includes(id))
          out.push({ t: "keyword", v: id });
        else out.push({ t: "id", v: id });
        continue;
      }

      out.push({ t: "symbol", v: this.next() });
    }
    out.push({ t: "eof", v: "" });
    return out;
  }
}

/* ---------------- Parser ---------------- */
class Parser {
  constructor(tokens) { this.tokens = tokens; this.i = 0; }
  peek() { return this.tokens[this.i]; }
  next() { return this.tokens[this.i++]; }
  matchSymbol(v) { if (this.peek().t === "symbol" && this.peek().v === v) { this.next(); return true; } return false; }
  matchId(v) { if (this.peek().t === "id" && (v === undefined || this.peek().v === v)) { this.next(); return true; } return false; }
  matchKeyword(v) { if (this.peek().t === "keyword" && this.peek().v === v) { this.next(); return true; } return false; }

  parseProgram() { const out = []; while (this.peek().t !== "eof") out.push(this.parseStmt()); return out; }

  parseStmt() {
    if (this.peek().t === "keyword" && this.peek().v === "let") return this.parseLet();
    if (this.peek().t === "keyword" && this.peek().v === "return") return this.parseReturn();
    if (this.peek().t === "keyword" && this.peek().v === "if") return this.parseIf();
    if (this.peek().t === "keyword" && this.peek().v === "while") return this.parseWhile();
    if (this.peek().t === "keyword" && this.peek().v === "for") return this.parseFor();
    if (this.peek().t === "keyword" && this.peek().v === "import") return this.parseImport();
    if (this.peek().t === "keyword" && this.peek().v === "fn") return this.parseFn();
    if (this.peek().t === "keyword" && this.peek().v === "break") { this.next(); if (this.matchSymbol(";")){} return { kind: "break" }; }
    if (this.peek().t === "keyword" && this.peek().v === "continue") { this.next(); if (this.matchSymbol(";")){} return { kind: "continue" }; }

    const e = this.parseExpr();
    if (this.peek().t === "symbol" && this.peek().v === "=") {
      this.next();
      const rhs = this.parseExpr();
      if (this.matchSymbol(";")) {}
      return { kind: "assign", target: e, expr: rhs };
    }
    if (this.peek().t === "symbol" && this.peek().v === ";") this.next();
    return { kind: "expr", expr: e };
  }

  parseImport() {
    this.next(); // consume 'import'
    const tk = this.peek();
    if (tk.t !== "string") throw new Error("import expects a string literal");
    const file = this.next().v;
    // Optional alias: import "file.vx" as name;
    let alias = null;
    if (this.peek().t === "keyword" && this.peek().v === "as") {
      this.next();
      if (this.peek().t !== "id") throw new Error("import 'as' expects identifier");
      alias = this.next().v;
    }
    if (this.matchSymbol(";")) {}
    return { kind: "import", file, alias };
  }

  parseFn() {
    this.next(); // consume 'fn'
    if (this.peek().t !== "id") throw new Error("fn expects a name");
    const name = this.next().v;

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

    return { kind: "fn", name, params, body };
  }

  parseLet() {
    this.next();
    if (this.peek().t !== "id") throw new Error("let expects identifier");
    const name = this.next().v;
    if (!this.matchSymbol("=")) throw new Error("let missing =");
    const expr = this.parseExpr();
    if (this.matchSymbol(";")) {}
    return { kind: "let", name, expr };
  }

  parseReturn() {
    this.next();
    if (this.peek().t === "symbol" && this.peek().v === ";") { this.next(); return { kind: "return" }; }
    const e = this.parseExpr();
    if (this.matchSymbol(";")) {}
    return { kind: "return", expr: e };
  }

  parseIf() {
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
    return { kind: "if", cond, then, otherwise };
  }

  parseWhile() {
    this.next();
    const cond = this.parseExpr();
    if (!this.matchSymbol("{")) throw new Error("while missing {");
    const body = [];
    while (!this.matchSymbol("}")) body.push(this.parseStmt());
    return { kind: "while", cond, body };
  }

  parseFor() {
    this.next();
    if (this.peek().t !== "id") throw new Error("for expects identifier");
    const iterator = this.next().v;
    if (!(this.peek().t === "keyword" && this.peek().v === "in")) throw new Error("for missing 'in'");
    this.next();
    const iterable = this.parseExpr();
    if (!this.matchSymbol("{")) throw new Error("for missing {");
    const body = [];
    while (!this.matchSymbol("}")) body.push(this.parseStmt());
    return { kind: "for", iterator, iterable, body };
  }

  parseExpr() { return this.parseBinary(0); }

  precedence(op) { return { "||":1, "&&":2, "==":3, "!=":3, ">":4, "<":4, ">=":4, "<=":4, "+":5, "-":5, "*":6, "/":6, "%":6 }[op] || 0; }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    while (true) {
      const tk = this.peek();
      let op = null;
      if (tk.t === "symbol" && ["+","-","*","/","%","==","!=","<","<=",">",">=","&&","||"].includes(tk.v)) op = tk.v;
      if (!op) break;
      const prec = this.precedence(op);
      if (prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { kind: "bin", op, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.peek().t === "symbol" && this.peek().v === "-") { this.next(); const e = this.parseUnary(); return { kind: "bin", op: "*", left: { kind: "num", value: -1 }, right: e }; }
    if (this.peek().t === "symbol" && this.peek().v === "!") { this.next(); return { kind: "unary", op: "!", expr: this.parseUnary() }; }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tk = this.peek();
    if (tk.t === "number") { this.next(); return { kind: "num", value: Number(tk.v) }; }
    if (tk.t === "string") { this.next(); return { kind: "str", value: tk.v }; }
    if (tk.t === "keyword" && (tk.v === "true" || tk.v === "false" || tk.v === "null")) {
      this.next();
      if (tk.v === "true") return { kind: "bool", value: true };
      if (tk.v === "false") return { kind: "bool", value: false };
      return { kind: "null", value: null };
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
      return { kind: "array", elements: elems };
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
      return { kind: "obj", entries };
    }

    if (tk.t === "id") {
      this.next();
      let node = { kind: "var", name: tk.v };
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
          node = { kind: "call", callee: node, args };
          continue;
        }
        if (this.peek().t === "symbol" && this.peek().v === "[") {
          this.next();
          const idx = this.parseExpr();
          if (!this.matchSymbol("]")) throw new Error("missing ]");
          node = { kind: "index", target: node, index: idx };
          continue;
        }
        if (this.peek().t === "symbol" && this.peek().v === ".") {
          this.next();
          if (this.peek().t !== "id") throw new Error("expected property name after .");
          const name = this.next().v;
          node = { kind: "prop", target: node, name };
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
  IMPORT: "IMPORT"
};

/* ---------------- Compiler ---------------- */
class Compiler {
  constructor() { this.consts = []; this.code = []; this.loopStack = []; }
  addConst(v) { const idx = this.consts.indexOf(v); if (idx !== -1) return idx; this.consts.push(v); return this.consts.length - 1; }
  emit(inst) { this.code.push(inst); }

  compile(stmts) {
    this.consts = [];
    this.code = [];
    return this.compileProgram(stmts);
  }

  compileProgram(stmts) {
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      const isLast = (i === stmts.length - 1);
      if (isLast && s.kind === "expr") this.emitExpr(s.expr);
      else this.emitStmt(s);
    }
    this.emit({ op: Op.HALT });
    return { consts: this.consts, code: this.code };
  }

  emitStmt(s) {
    switch (s.kind) {
      case "expr":
        this.emitExpr(s.expr);
        this.emit({ op: Op.POP });
        break;
      case "let":
        this.emitExpr(s.expr);
        this.emit({ op: Op.STORE, arg: this.addConst(s.name) });
        break;
      case "assign": {
        const t = s.target;
        if (t.kind === "var") {
          this.emitExpr(s.expr);
          this.emit({ op: Op.STORE, arg: this.addConst(t.name) });
        } else if (t.kind === "index") {
          this.emitExpr(t.target);
          this.emitExpr(t.index);
          this.emitExpr(s.expr);
          this.emit({ op: Op.SETINDEX });
        } else if (t.kind === "prop") {
          this.emitExpr(t.target);
          this.emit({ op: Op.CONST, arg: this.addConst(t.name) });
          this.emitExpr(s.expr);
          this.emit({ op: Op.SETPROP });
        } else throw new Error("Unsupported assignment target");
        break;
      }
      case "import": {
        this.emit({ op: Op.IMPORT, arg: this.addConst(s.file) });
        // If alias present, IMPORT will push module object; store it
        if (s.alias) {
          this.emit({ op: Op.STORE, arg: this.addConst(s.alias) });
        }
        break;
      }
      case "fn": {
        const subCompiler = new Compiler();
        const bytecode = subCompiler.compile(s.body); // includes HALT
        const funcObj = { params: s.params, code: bytecode.code, consts: bytecode.consts };
        this.emit({ op: Op.CONST, arg: this.addConst(funcObj) });
        this.emit({ op: Op.STORE, arg: this.addConst(s.name) });
        break;
      }
      case "return": {
        if (s.expr) this.emitExpr(s.expr);
        this.emit({ op: Op.RET });
        break;
      }
      case "if": {
        this.emitExpr(s.cond);
        const jmpfPos = this.code.length;
        this.emit({ op: Op.JMPF, arg: null });
        for (const st of s.then) this.emitStmt(st);
        const jmpEndPos = this.code.length;
        this.emit({ op: Op.JMP, arg: null });
        this.code[jmpfPos].arg = this.code.length;
        for (const st of s.otherwise) this.emitStmt(st);
        this.code[jmpEndPos].arg = this.code.length;
        break;
      }
      case "while": {
        const start = this.code.length;
        this.loopStack.push({ breaks: [], continues: [], start });
        this.emitExpr(s.cond);
        const jmpf = this.code.length;
        this.emit({ op: Op.JMPF, arg: null });
        for (const st of s.body) this.emitStmt(st);
        const loopInfo = this.loopStack.pop();
        for (const cpos of loopInfo.continues) this.code[cpos].arg = start;
        this.emit({ op: Op.JMP, arg: start });
        this.code[jmpf].arg = this.code.length;
        for (const bpos of loopInfo.breaks) this.code[bpos].arg = this.code.length;
        break;
      }
      case "for": {
        const iterName = "__iter_" + Math.floor(Math.random() * 1e9);
        const idxName = "__i_" + Math.floor(Math.random() * 1e9);
        // __iter = iterable
        this.emitExpr(s.iterable);
        this.emit({ op: Op.STORE, arg: this.addConst(iterName) });
        // __i = 0
        this.emit({ op: Op.CONST, arg: this.addConst(0) });
        this.emit({ op: Op.STORE, arg: this.addConst(idxName) });
        const start = this.code.length;
        this.loopStack.push({ breaks: [], continues: [], start });
        // load __i
        this.emit({ op: Op.LOAD, arg: this.addConst(idxName) });
        // load len(__iter) -> push callee "len", then argument __iter, then CALL 1
        this.emit({ op: Op.LOAD, arg: this.addConst("len") });
        this.emit({ op: Op.LOAD, arg: this.addConst(iterName) });
        this.emit({ op: Op.CALL, arg: 1 });
        // compare <
        this.emit({ op: Op.LT });
        const jmpf = this.code.length;
        this.emit({ op: Op.JMPF, arg: null });
        // set iterator var = __iter[__i]
        this.emit({ op: Op.LOAD, arg: this.addConst(iterName) });
        this.emit({ op: Op.LOAD, arg: this.addConst(idxName) });
        this.emit({ op: Op.INDEX });
        this.emit({ op: Op.STORE, arg: this.addConst(s.iterator) });
        // body
        for (const st of s.body) this.emitStmt(st);
        // continue targets -> patch to here (increment)
        const loopInfo = this.loopStack.pop();
        const continueTarget = this.code.length;
        for (const cpos of loopInfo.continues) this.code[cpos].arg = continueTarget;
        // __i = __i + 1
        this.emit({ op: Op.LOAD, arg: this.addConst(idxName) });
        this.emit({ op: Op.CONST, arg: this.addConst(1) });
        this.emit({ op: Op.ADD });
        this.emit({ op: Op.STORE, arg: this.addConst(idxName) });
        // jump back
        this.emit({ op: Op.JMP, arg: start });
        // patch jmpf and breaks
        this.code[jmpf].arg = this.code.length;
        for (const bpos of loopInfo.breaks) this.code[bpos].arg = this.code.length;
        break;
      }
      case "break": {
        if (this.loopStack.length === 0) throw new Error("break outside loop");
        this.emit({ op: Op.JMP, arg: null });
        const info = this.loopStack[this.loopStack.length - 1];
        info.breaks.push(this.code.length - 1);
        break;
      }
      case "continue": {
        if (this.loopStack.length === 0) throw new Error("continue outside loop");
        this.emit({ op: Op.JMP, arg: null });
        const info = this.loopStack[this.loopStack.length - 1];
        info.continues.push(this.code.length - 1);
        break;
      }
      default:
        throw new Error("Unsupported stmt kind: " + s.kind);
    }
  }

  emitExpr(e) {
    switch (e.kind) {
      case "num": this.emit({ op: Op.CONST, arg: this.addConst(Number(e.value)) }); break;
      case "str": this.emit({ op: Op.CONST, arg: this.addConst(e.value) }); break;
      case "bool": this.emit({ op: Op.CONST, arg: this.addConst(e.value) }); break;
      case "null": this.emit({ op: Op.CONST, arg: this.addConst(null) }); break;
      case "var": this.emit({ op: Op.LOAD, arg: this.addConst(e.name) }); break;
      case "array":
        for (const el of e.elements) this.emitExpr(el);
        this.emit({ op: Op.NEWARRAY, arg: e.elements.length });
        break;
      case "obj":
        for (const en of e.entries) {
          this.emit({ op: Op.CONST, arg: this.addConst(en.key) });
          this.emitExpr(en.value);
        }
        this.emit({ op: Op.NEWOBJ, arg: e.entries.length });
        break;
      case "index":
        this.emitExpr(e.target);
        this.emitExpr(e.index);
        this.emit({ op: Op.INDEX });
        break;
      case "prop":
        this.emitExpr(e.target);
        this.emit({ op: Op.CONST, arg: this.addConst(e.name) });
        this.emit({ op: Op.INDEX });
        break;
      case "bin": {
        if (e.op === "&&") {
          this.emitExpr(e.left);
          const jmpfPos = this.code.length; this.emit({ op: Op.JMPF, arg: null });
          this.emit({ op: Op.POP });
          this.emitExpr(e.right);
          const jmpEnd = this.code.length; this.emit({ op: Op.JMP, arg: null });
          this.code[jmpfPos].arg = this.code.length;
          this.code[jmpEnd].arg = this.code.length;
          break;
        }
        if (e.op === "||") {
          this.emitExpr(e.left);
          const jmpTruthPos = this.code.length; this.emit({ op: Op.JMPF, arg: null });
          const jmpToEnd = this.code.length; this.emit({ op: Op.JMP, arg: null });
          this.code[jmpTruthPos].arg = this.code.length;
          this.emit({ op: Op.POP });
          this.emitExpr(e.right);
          this.code[jmpToEnd].arg = this.code.length;
          break;
        }
        this.emitExpr(e.left);
        this.emitExpr(e.right);
        switch (e.op) {
          case "+": this.emit({ op: Op.ADD }); break;
          case "-": this.emit({ op: Op.SUB }); break;
          case "*": this.emit({ op: Op.MUL }); break;
          case "/": this.emit({ op: Op.DIV }); break;
          case "%": this.emit({ op: Op.MOD }); break;
          case "==": this.emit({ op: Op.EQ }); break;
          case "!=": this.emit({ op: Op.NEQ }); break;
          case "<": this.emit({ op: Op.LT }); break;
          case "<=": this.emit({ op: Op.LTE }); break;
          case ">": this.emit({ op: Op.GT }); break;
          case ">=": this.emit({ op: Op.GTE }); break;
          default: throw new Error("Unsupported binary op: " + e.op);
        }
        break;
      }
      case "unary":
        this.emitExpr(e.expr);
        if (e.op === "!") this.emit({ op: Op.NOT });
        else throw new Error("Unsupported unary op: " + e.op);
        break;
      case "call": {
        this.emitExpr(e.callee);
        for (const a of e.args) this.emitExpr(a);
        this.emit({ op: Op.CALL, arg: e.args.length });
        break;
      }
      default:
        throw new Error("Unsupported expr kind: " + e.kind);
    }
  }
}

/* ---------------- VM (with frames / call stack) ---------------- */
class VM {
  constructor(consts = [], code = [], options = {}) {
    // Global consts and code (top-level program)
    this.consts = Array.from(consts);
    this.code = Array.from(code);

    // frames: each frame = { code, consts, ip, locals: Map(), isGlobal: bool }
    // initial (global) frame will be created at run() start
    this.frames = [];

    this.stack = [];      // shared data stack for values/ops
    this.globals = new Map(); // global variables / builtins
    this.importedFiles = new Set(); // import cache
    this.baseDir = options.baseDir || process.cwd();
    this.debug = !!options.debug;

    this.setupBuiltins();
  }

  setupBuiltins() {
    // Basic printing
    this.globals.set("print", { builtin: true, call: (args) => { console.log(...args.map(a => (a === null ? "null" : a))); return null; } });

    // len
    this.globals.set("len", { builtin: true, call: (args) => {
      const v = args[0];
      if (Array.isArray(v) || typeof v === "string") return v.length;
      if (v && typeof v === "object") return Object.keys(v).length;
      return 0;
    }});

    // range
    this.globals.set("range", { builtin: true, call: (args) => {
      let start = 0, end = 0;
      if (args.length === 1) { end = args[0]; }
      else if (args.length >= 2) { start = args[0]; end = args[1]; }
      const out = []; for (let i = start; i < end; i++) out.push(i); return out;
    }});

    // push/pop helpers
    this.globals.set("push", { builtin: true, call: (args) => { const a = args[0]; a.push(args[1]); return a.length; }});
    this.globals.set("pop", { builtin: true, call: (args) => { const a = args[0]; return a.pop(); }});

    // input (sync)
    this.globals.set("input", { builtin: true, call: (args) => {
      const prompt = args.length ? String(args[0]) : "";
      if (readlineSync) return readlineSync.question(prompt);
      try {
        try { fs.writeSync(1, prompt); } catch (e) {}
        const buf = Buffer.alloc(1024);
        let input = "";
        while (true) {
          const bytes = fs.readSync(0, buf, 0, buf.length, null);
          if (bytes <= 0) break;
          input += buf.toString("utf8", 0, bytes);
          if (input.includes("\n")) break;
        }
        return input.replace(/\r?\n$/, "");
      } catch (e) {
        throw new Error("input() not available: " + e.message);
      }
    }});

    // ---------------- FILE SYSTEM ----------------
    this.globals.set("read", { builtin: true, call: (args) => {
      const p = String(args[0]);
      return fs.readFileSync(path.resolve(this.baseDir, p), "utf8");
    }});

    this.globals.set("write", { builtin: true, call: (args) => {
      const p = String(args[0]); const data = args[1] ?? "";
      fs.writeFileSync(path.resolve(this.baseDir, p), String(data), "utf8");
      return null;
    }});

    this.globals.set("append", { builtin: true, call: (args) => {
      const p = String(args[0]); const data = args[1] ?? "";
      fs.appendFileSync(path.resolve(this.baseDir, p), String(data), "utf8");
      return null;
    }});

    this.globals.set("exists", { builtin: true, call: (args) => {
      const p = String(args[0]);
      return fs.existsSync(path.resolve(this.baseDir, p));
    }});

    this.globals.set("delete", { builtin: true, call: (args) => {
      const p = String(args[0]);
      const full = path.resolve(this.baseDir, p);
      if (fs.existsSync(full)) fs.unlinkSync(full);
      return null;
    }});

    this.globals.set("list", { builtin: true, call: (args) => {
      const p = args.length ? String(args[0]) : ".";
      return fs.readdirSync(path.resolve(this.baseDir, p));
    }});

    this.globals.set("mkdir", { builtin: true, call: (args) => {
      const p = String(args[0]);
      const full = path.resolve(this.baseDir, p);
      if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
      return null;
    }});

    this.globals.set("cwd", { builtin: true, call: () => process.cwd() });

    // ---------------- JSON ----------------
    this.globals.set("json_encode", { builtin: true, call: (args) => JSON.stringify(args[0], null, 2) });
    this.globals.set("json_decode", { builtin: true, call: (args) => JSON.parse(String(args[0])) });

    // ---------------- TIME / RANDOM ----------------
    this.globals.set("time", { builtin: true, call: () => Date.now() });
    this.globals.set("random", { builtin: true, call: () => Math.random() });

    // ---------------- toString ----------------
    this.globals.set("toString", { builtin: true, call: (args) => {
      const obj = args[0];
      if (obj === null) return "null";
      if (Array.isArray(obj)) return "[" + obj.map(item => (item === null ? "null" : (typeof item === "object" ? JSON.stringify(item, null, 2) : String(item)))).join(", ") + "]";
      if (typeof obj === "object") return JSON.stringify(obj, null, 2);
      return String(obj);
    }});

    // ---------------- PROCESS EXECUTION ----------------
    this.globals.set("exec", { builtin: true, call: (args) => {
      const cmd = String(args[0]);
      try {
        const out = child_process.execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
        return out.trim();
      } catch (e) {
        return String(e);
      }
    }});

    // ---------------- SLEEP (sync) ----------------
    this.globals.set("sleep", { builtin: true, call: (args) => {
      const ms = Number(args[0] ?? 0);
      const sab = new SharedArrayBuffer(4);
      const int32 = new Int32Array(sab);
      try {
        Atomics.wait(int32, 0, 0, ms);
      } catch (e) {}
      return null;
    }});

    // ---------------- HTTP CLIENT (async) ----------------
    this.globals.set("http_get", { builtin: true, call: async (args) => {
      if (!fetchImpl) throw new Error("fetch not available (install node-fetch for older Node)");
      const url = String(args[0]);
      const res = await fetchImpl(url);
      const ct = res.headers && (res.headers.get ? res.headers.get("content-type") : res.headers["content-type"]);
      if (ct && ct.includes("application/json")) {
        return await res.json();
      }
      return await res.text();
    }});

    this.globals.set("http_post", { builtin: true, call: async (args) => {
      if (!fetchImpl) throw new Error("fetch not available (install node-fetch for older Node)");
      const url = String(args[0]);
      const payload = args[1];
      const body = (typeof payload === "string") ? payload : JSON.stringify(payload);
      const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const ct = res.headers && (res.headers.get ? res.headers.get("content-type") : res.headers["content-type"]);
      if (ct && ct.includes("application/json")) return await res.json();
      return await res.text();
    }});

    // ---------------- MATH (object with wrapped functions) ----------------
    const mathObj = {};
    mathObj.sin  = { builtin: true, call: (args) => Math.sin(Number(args[0])) };
    mathObj.cos  = { builtin: true, call: (args) => Math.cos(Number(args[0])) };
    mathObj.sqrt = { builtin: true, call: (args) => Math.sqrt(Number(args[0])) };
    mathObj.abs  = { builtin: true, call: (args) => Math.abs(Number(args[0])) };
    mathObj.pow  = { builtin: true, call: (args) => Math.pow(Number(args[0]), Number(args[1])) };
    mathObj.round = { builtin: true, call: (args) => Math.round(Number(args[0])) };
    mathObj.floor = { builtin: true, call: (args) => Math.floor(Number(args[0])) };
    mathObj.ceil  = { builtin: true, call: (args) => Math.ceil(Number(args[0])) };
    this.globals.set("math", mathObj);

    // ---------------- keys helper ----------------
    this.globals.set("keys", { builtin: true, call: (args) => {
      const obj = args[0];
      if (obj && typeof obj === "object") return Object.keys(obj);
      return [];
    }});

    // ---------------- STRING HELPERS ----------------
    this.globals.set("split", { builtin: true, call: (args) => {
      const str = String(args[0]); const sep = String(args[1]);
      return str.split(sep);
    }});
    this.globals.set("indexOf", { builtin: true, call: (args) => {
      const str = String(args[0]); const sub = String(args[1]);
      return str.indexOf(sub);
    }});
    this.globals.set("substring", { builtin: true, call: (args) => {
      const str = String(args[0]);
      const start = Number(args[1]);
      const end = (args.length > 2) ? Number(args[2]) : undefined;
      return str.substring(start, end);
    }});
    this.globals.set("trim", { builtin: true, call: (args) => String(args[0]).trim() });
    this.globals.set("startsWith", { builtin: true, call: (args) => String(args[0]).startsWith(String(args[1])) });
    this.globals.set("endsWith", { builtin: true, call: (args) => String(args[0]).endsWith(String(args[1])) });
    this.globals.set("toLower", { builtin: true, call: (args) => String(args[0]).toLowerCase() });
    this.globals.set("toUpper", { builtin: true, call: (args) => String(args[0]).toUpperCase() });
    this.globals.set("replace", { builtin: true, call: (args) => {
      const s = String(args[0]), a = String(args[1]), b = String(args[2]);
      return s.split(a).join(b);
    }});

    // ---------------- NUMBER HELPERS ----------------
    this.globals.set("number", { builtin: true, call: (args) => Number(args[0]) });
    this.globals.set("parseInt", { builtin: true, call: (args) => parseInt(String(args[0]), Number(args[1] ?? 10)) });
    this.globals.set("parseFloat", { builtin: true, call: (args) => parseFloat(String(args[0])) });
    this.globals.set("isNaN", { builtin: true, call: (args) => Number.isNaN(Number(args[0])) });

    // ---------------- IO HELPERS ----------------
    this.globals.set("read_json", { builtin: true, call: (args) => {
      const p = String(args[0]);
      return JSON.parse(fs.readFileSync(path.resolve(this.baseDir, p), "utf8"));
    }});
    this.globals.set("write_json", { builtin: true, call: (args) => {
      const p = String(args[0]); const obj = args[1];
      fs.writeFileSync(path.resolve(this.baseDir, p), JSON.stringify(obj, null, 2), "utf8");
      return null;
    }});
    this.globals.set("join_path", { builtin: true, call: (args) => path.join(...args.map(String)) });

    // ---------------- PROCESS HELPERS ----------------
    this.globals.set("env", { builtin: true, call: (args) => process.env[String(args[0])] });
    this.globals.set("set_env", { builtin: true, call: (args) => { process.env[String(args[0])] = String(args[1]); return null; }});
    this.globals.set("argv", { builtin: true, call: () => process.argv.slice(2) });

    // ---------------- GLOBAL MAP HELPERS ----------------
    // Note: these reference the VM instance via closure; bind later.
    // We'll bind these after setup to capture 'this' cleanly.
  }

  // Bind global_set/global_get to this VM instance
  bindGlobalHelpers() {
    const self = this;
    this.globals.set("global_set", { builtin: true, call: (args) => { self.globals.set(String(args[0]), args[1]); return null; }});
    this.globals.set("global_get", { builtin: true, call: (args) => self.globals.get(String(args[0])) });
  }

  // Import: compile module and append its bytecode to global consts/code and push a new frame
  importFile(relOrAbsPath) {
    const abs = path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.resolve(this.baseDir, relOrAbsPath);

    if (this.importedFiles.has(abs)) {
      // Return an empty module object if already imported
      return {};
    }
    this.importedFiles.add(abs);

    if (!fs.existsSync(abs)) throw new Error("Imported file not found: " + abs);
    const src = fs.readFileSync(abs, "utf8");
    const lexer = new Lexer(src);
    const tokens = lexer.lex();
    const parser = new Parser(tokens);
    const ast = parser.parseProgram();
    const compiler = new Compiler();
    const { consts: newConsts, code: newCode } = compiler.compile(ast);

    const constStart = this.consts.length;
    this.consts.push(...newConsts);

    const codeStart = this.code.length;
    const adjusted = newCode.map(instr => {
      const ni = Object.assign({}, instr);
      if (ni.arg !== undefined && typeof ni.arg === "number") {
        if (ni.op === Op.CONST || ni.op === Op.LOAD || ni.op === Op.STORE || ni.op === Op.IMPORT) {
          ni.arg = ni.arg + constStart;
        } else if (ni.op === Op.JMP || ni.op === Op.JMPF) {
          ni.arg = ni.arg + codeStart;
        }
      }
      return ni;
    });

    const moduleStartIp = this.code.length;
    this.code.push(...adjusted);

    // Snapshot globals before running module
    const beforeKeys = new Set(Array.from(this.globals.keys()));

    // Push a module frame so the main run() loop will pick it up naturally
    const moduleFrame = { code: this.code, consts: this.consts, ip: moduleStartIp, locals: new Map(), isGlobal: false };
    this.frames.push(moduleFrame);

    // Run module synchronously inside import to completion (mini loop)
    // Note: We run until moduleFrame is popped.
    const moduleObjPromise = (async () => {
      while (this.frames.includes(moduleFrame)) {
        const frame = this.currentFrame();
        if (!frame) break;
        if (frame.ip >= frame.code.length) { this.frames.pop(); continue; }

        const instr = frame.code[frame.ip++];
        if (this.debug) {
          const argStr = (instr.arg !== undefined) ? ` ${JSON.stringify(instr.arg)}` : "";
          console.log(`[import ip=${frame.ip-1}] ${instr.op}${argStr}`);
        }

        try {
          switch (instr.op) {
            case Op.CONST:
              this.stack.push(frame.consts[instr.arg]); break;
            case Op.LOAD: {
              const name = frame.consts[instr.arg];
              if (frame.locals && frame.locals.has(name)) this.stack.push(frame.locals.get(name));
              else if (this.globals.has(name)) this.stack.push(this.globals.get(name));
              else this.stack.push(undefined);
              break;
            }
            case Op.STORE: {
              const name = frame.consts[instr.arg];
              const val = this.stack.pop();
              if (frame.isGlobal) this.globals.set(name, val);
              else {
                if (this.globals.has(name)) this.globals.set(name, val);
                else frame.locals.set(name, val);
              }
              break;
            }
            case Op.POP: this.stack.pop(); break;
            case Op.ADD: { const b = this.stack.pop(), a = this.stack.pop(); if (typeof a === "string" || typeof b === "string") this.stack.push(String(a) + String(b)); else this.stack.push(a + b); break; }
            case Op.SUB: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a - b); break; }
            case Op.MUL: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a * b); break; }
            case Op.DIV: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a / b); break; }
            case Op.MOD: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a % b); break; }
            case Op.EQ: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a === b); break; }
            case Op.NEQ: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a !== b); break; }
            case Op.LT: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a < b); break; }
            case Op.LTE: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a <= b); break; }
            case Op.GT: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a > b); break; }
            case Op.GTE: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a >= b); break; }
            case Op.NOT: { const a = this.stack.pop(); this.stack.push(!a); break; }
            case Op.NEWARRAY: { const n = instr.arg; const arr = []; for (let i = 0; i < n; i++) arr.unshift(this.stack.pop()); this.stack.push(arr); break; }
            case Op.NEWOBJ: {
              const n = instr.arg; const obj = {};
              for (let i = 0; i < n; i++) { const val = this.stack.pop(); const key = this.stack.pop(); obj[key] = val; }
              this.stack.push(obj); break;
            }
            case Op.INDEX: {
              const idx = this.stack.pop(); const target = this.stack.pop();
              if (Array.isArray(target) || typeof target === "string") this.stack.push(target[idx]);
              else if (target && typeof target === "object") this.stack.push(target[idx]);
              else this.stack.push(undefined);
              break;
            }
            case Op.SETINDEX: {
              const val = this.stack.pop(); const idx = this.stack.pop(); const target = this.stack.pop();
              if (Array.isArray(target)) target[idx] = val;
              else if (target && typeof target === "object") target[idx] = val;
              this.stack.push(val); break;
            }
            case Op.CALL: {
              const argc = instr.arg;
              const args = [];
              for (let i = 0; i < argc; i++) args.unshift(this.stack.pop());
              const callee = this.stack.pop();
              if (!callee) throw new Error("Call to unknown: " + JSON.stringify(argc === 1 ? args[0] : args));
              if (callee && callee.builtin && typeof callee.call === "function") {
                const res = callee.call(args);
                const val = (res instanceof Promise) ? await res : res;
                this.stack.push(val);
                break;
              }
              if (typeof callee === "function") {
                const res = callee(...args);
                const val = (res instanceof Promise) ? await res : res;
                this.stack.push(val);
                break;
              }
              if (callee && callee.code && callee.params) {
                const fnFrame = { code: callee.code, consts: callee.consts, ip: 0, locals: new Map(), isGlobal: false };
                for (let i = 0; i < callee.params.length; i++) fnFrame.locals.set(callee.params[i], args[i]);
                this.frames.push(fnFrame);
                break;
              }
              throw new Error("Unsupported call target");
            }
            case Op.JMP: moduleFrame.ip = instr.arg; break;
            case Op.JMPF: { const cond = this.stack.pop(); if (!cond) moduleFrame.ip = instr.arg; break; }
            case Op.RET: {
              const retVal = this.stack.pop();
              this.frames.pop();
              if (this.frames.length > 0) this.stack.push(retVal);
              else return retVal;
              break;
            }
            case Op.IMPORT: {
              const file = moduleFrame.consts[instr.arg];
              this.importFile(file);
              break;
            }
            case Op.HALT: {
              const returnVal = this.stack.length ? this.stack[this.stack.length - 1] : null;
              this.frames.pop();
              if (this.frames.length > 0) this.stack.push(returnVal);
              else return returnVal;
              break;
            }
            default:
              throw new Error("Unknown op: " + instr.op);
          }
        } catch (e) {
          throw new Error(`[IMPORT ${instr.op} @ ip=${frame.ip-1}] ${e.message}`);
        }
      }

      // Build module object from globals delta
      const afterKeys = Array.from(this.globals.keys());
      const mod = {};
      for (const k of afterKeys) {
        if (!beforeKeys.has(k)) {
          // Exclude builtins by convention: we won't exclude, but you could filter known builtin names here
          mod[k] = this.globals.get(k);
        }
      }
      return mod;
    })();

    // Return module object (will be awaited in main run)
    return modObjPromise;
  }

  // Internal helper: current frame (top of stack)
  currentFrame() {
    if (this.frames.length === 0) return null;
    return this.frames[this.frames.length - 1];
  }

  // Run interpreter. This processes frames stack until global HALT returns.
  async run() {
    // Bind helpers that need VM instance
    this.bindGlobalHelpers();

    // If no frames, push initial global frame
    if (this.frames.length === 0) {
      this.frames.push({ code: this.code, consts: this.consts, ip: 0, locals: new Map(), isGlobal: true });
    }

    while (this.frames.length > 0) {
      const frame = this.currentFrame();
      if (!frame) break;
      if (frame.ip >= frame.code.length) {
        this.frames.pop();
        continue;
      }

      const instr = frame.code[frame.ip++];
      if (this.debug) {
        const argStr = (instr.arg !== undefined) ? ` ${JSON.stringify(instr.arg)}` : "";
        const top = this.stack.length ? JSON.stringify(this.stack[this.stack.length - 1]) : "empty";
        console.log(`[ip=${frame.ip-1}] ${instr.op}${argStr} | stackTop=${top}`);
      }

      try {
        switch (instr.op) {
          case Op.CONST:
            this.stack.push(frame.consts[instr.arg]);
            break;

          case Op.LOAD: {
            const name = frame.consts[instr.arg];
            if (frame.locals && frame.locals.has(name)) {
              this.stack.push(frame.locals.get(name));
            } else if (this.globals.has(name)) {
              this.stack.push(this.globals.get(name));
            } else {
              this.stack.push(undefined);
            }
            break;
          }

          case Op.STORE: {
            const name = frame.consts[instr.arg];
            const val = this.stack.pop();
            if (frame.isGlobal) {
              this.globals.set(name, val);
            } else {
              if (this.globals.has(name)) {
                this.globals.set(name, val);
              } else {
                frame.locals.set(name, val);
              }
            }
            break;
          }

          case Op.POP:
            this.stack.pop();
            break;

          case Op.ADD: {
            const b = this.stack.pop(), a = this.stack.pop();
            if (typeof a === "string" || typeof b === "string") this.stack.push(String(a) + String(b));
            else this.stack.push(a + b);
            break;
          }
          case Op.SUB: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a - b); break; }
          case Op.MUL: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a * b); break; }
          case Op.DIV: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a / b); break; }
          case Op.MOD: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a % b); break; }
          case Op.EQ: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a === b); break; }
          case Op.NEQ: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a !== b); break; }
          case Op.LT: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a < b); break; }
          case Op.LTE: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a <= b); break; }
          case Op.GT: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a > b); break; }
          case Op.GTE: { const b = this.stack.pop(), a = this.stack.pop(); this.stack.push(a >= b); break; }
          case Op.NOT: { const a = this.stack.pop(); this.stack.push(!a); break; }

          case Op.NEWARRAY: {
            const n = instr.arg; const arr = [];
            for (let i = 0; i < n; i++) arr.unshift(this.stack.pop());
            this.stack.push(arr); break;
          }

          case Op.NEWOBJ: {
            const n = instr.arg; const obj = {};
            for (let i = 0; i < n; i++) {
              const val = this.stack.pop(); const key = this.stack.pop();
              obj[key] = val;
            }
            this.stack.push(obj); break;
          }

          case Op.INDEX: {
            const idx = this.stack.pop(); const target = this.stack.pop();
            if (Array.isArray(target) || typeof target === "string") this.stack.push(target[idx]);
            else if (target && typeof target === "object") this.stack.push(target[idx]);
            else this.stack.push(undefined);
            break;
          }

          case Op.SETINDEX: {
            const val = this.stack.pop(); const idx = this.stack.pop(); const target = this.stack.pop();
            if (Array.isArray(target)) target[idx] = val;
            else if (target && typeof target === "object") target[idx] = val;
            this.stack.push(val);
            break;
          }

          case Op.CALL: {
            const argc = instr.arg;
            const args = [];
            for (let i = 0; i < argc; i++) args.unshift(this.stack.pop());
            const callee = this.stack.pop();
            if (!callee) throw new Error("Call to unknown: " + JSON.stringify(argc === 1 ? args[0] : args));

            // builtin (wrapper objects with {builtin:true, call: fn})
            if (callee && callee.builtin && typeof callee.call === "function") {
              const res = callee.call(args);
              const val = (res instanceof Promise) ? await res : res;
              this.stack.push(val);
              break;
            }

            // Plain JS function
            if (typeof callee === "function") {
              const res = callee(...args);
              const val = (res instanceof Promise) ? await res : res;
              this.stack.push(val);
              break;
            }

            // user-defined function: object { params, code, consts }
            if (callee && callee.code && callee.params) {
              const fnFrame = { code: callee.code, consts: callee.consts, ip: 0, locals: new Map(), isGlobal: false };
              for (let i = 0; i < callee.params.length; i++) {
                fnFrame.locals.set(callee.params[i], args[i]);
              }
              this.frames.push(fnFrame);
              break;
            }

            throw new Error("Unsupported call target");
          }

          case Op.JMP:
            frame.ip = instr.arg;
            break;

          case Op.JMPF: {
            const cond = this.stack.pop();
            if (!cond) frame.ip = instr.arg;
            break;
          }

          case Op.RET: {
            const retVal = this.stack.pop();
            this.frames.pop();
            if (this.frames.length > 0) {
              this.stack.push(retVal);
            } else {
              return retVal;
            }
            break;
          }

          case Op.IMPORT: {
            const file = frame.consts[instr.arg];
            const modObj = await this.importFile(file);
            // push module object for optional alias STORE
            this.stack.push(modObj);
            break;
          }

          case Op.HALT: {
            const returnVal = this.stack.length ? this.stack[this.stack.length - 1] : null;
            this.frames.pop();
            if (this.frames.length > 0) {
              this.stack.push(returnVal);
            } else {
              return returnVal;
            }
            break;
          }

          default:
            throw new Error("Unknown op: " + instr.op);
        }
      } catch (e) {
        throw new Error(`[${instr.op} @ ip=${frame.ip-1}] ${e.message}`);
      }
    }

    return null;
  }
}

module.exports = { Lexer, Parser, Compiler, VM, Op };
