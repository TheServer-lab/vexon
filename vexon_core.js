"use strict";
/*
  vexon_core.js — Full Vexon core with extended stdlib and robust import handling.

  Features:
  - Lexer, Parser, Compiler
  - VM with frames, call stack, async builtin support
  - Robust IMPORT handling with caching and relative resolution
  - Many builtins: print, input, fs, json, math, string, number helpers, http, exec, sleep, process helpers
  - Compile-time function support (fn), control flow, arrays/objects, calls, indexing, properties
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
  try { fetchImpl = require("node-fetch"); } catch (e) { fetchImpl = null; }
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
        this.emitExpr(s.iterable);
        this.emit({ op: Op.STORE, arg: this.addConst(iterName) });
        this.emit({ op: Op.CONST, arg: this.addConst(0) });
        this.emit({ op: Op.STORE, arg: this.addConst(idxName) });
        const start = this.code.length;
        this.loopStack.push({ breaks: [], continues: [], start });
        this.emit({ op: Op.LOAD, arg: this.addConst(idxName) });
        this.emit({ op: Op.LOAD, arg: this.addConst("len") });
        this.emit({ op: Op.LOAD, arg: this.addConst(iterName) });
        this.emit({ op: Op.CALL, arg: 1 });
        this.emit({ op: Op.LT });
        const jmpf = this.code.length;
        this.emit({ op: Op.JMPF, arg: null });
        this.emit({ op: Op.LOAD, arg: this.addConst(iterName) });
        this.emit({ op: Op.LOAD, arg: this.addConst(idxName) });
        this.emit({ op: Op.INDEX });
        this.emit({ op: Op.STORE, arg: this.addConst(s.iterator) });
        for (const st of s.body) this.emitStmt(st);
        const loopInfo = this.loopStack.pop();
        const continueTarget = this.code.length;
        for (const cpos of loopInfo.continues) this.code[cpos].arg = continueTarget;
        this.emit({ op: Op.LOAD, arg: this.addConst(idxName) });
        this.emit({ op: Op.CONST, arg: this.addConst(1) });
        this.emit({ op: Op.ADD });
        this.emit({ op: Op.STORE, arg: this.addConst(idxName) });
        this.emit({ op: Op.JMP, arg: start });
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
    this.consts = Array.from(consts);
    this.code = Array.from(code);

    // frames: each frame = { code, consts, ip, locals: Map(), baseDir, isGlobal }
    this.frames = [];
    this.stack = [];
    this.globals = new Map();
    this.importedFiles = new Set();
    this.importCache = new Map(); // absolutePath -> moduleObject or Promise
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
      const res = await fetchImpl(url, { method: "POST", body: typeof payload === "string" ? payload : JSON.stringify(payload), headers: { "Content-Type": "application/json" } });
      const ct = res.headers && (res.headers.get ? res.headers.get("content-type") : res.headers["content-type"]);
      if (ct && ct.includes("application/json")) return await res.json();
      return await res.text();
    }});

    // ---------------- Additional helpers (math, string, number, io, process) ----------------

    // Math namespace object (plain object) and callable math.* entries
    this.globals.set("math", { builtin: false, value: {
      sin: (v) => Math.sin(Number(v)),
      cos: (v) => Math.cos(Number(v)),
      sqrt: (v) => Math.sqrt(Number(v)),
      abs: (v) => Math.abs(Number(v)),
      pow: (a, b) => Math.pow(Number(a), Number(b ?? 0))
    }});

    this.globals.set("math.sin", { builtin: true, call: (args) => Math.sin(Number(args[0])) });
    this.globals.set("math.cos", { builtin: true, call: (args) => Math.cos(Number(args[0])) });
    this.globals.set("math.sqrt", { builtin: true, call: (args) => Math.sqrt(Number(args[0])) });
    this.globals.set("math.abs", { builtin: true, call: (args) => Math.abs(Number(args[0])) });
    this.globals.set("math.pow", { builtin: true, call: (args) => Math.pow(Number(args[0]), Number(args[1] ?? 0)) });

    // Rounding helpers
    this.globals.set("round", { builtin: true, call: (args) => Math.round(Number(args[0])) });
    this.globals.set("floor", { builtin: true, call: (args) => Math.floor(Number(args[0])) });
    this.globals.set("ceil", { builtin: true, call: (args) => Math.ceil(Number(args[0])) });

    // String helpers
    this.globals.set("split", { builtin: true, call: (args) => String(args[0]).split(String(args[1] ?? "")) });
    this.globals.set("indexOf", { builtin: true, call: (args) => String(args[0]).indexOf(String(args[1] ?? "")) });
    this.globals.set("substring", { builtin: true, call: (args) => String(args[0]).substring(Number(args[1] ?? 0), args.length > 2 ? Number(args[2]) : undefined) });
    this.globals.set("trim", { builtin: true, call: (args) => String(args[0]).trim() });
    this.globals.set("toLower", { builtin: true, call: (args) => String(args[0]).toLowerCase() });
    this.globals.set("toUpper", { builtin: true, call: (args) => String(args[0]).toUpperCase() });
    this.globals.set("startsWith", { builtin: true, call: (args) => String(args[0]).startsWith(String(args[1] ?? "")) });
    this.globals.set("endsWith", { builtin: true, call: (args) => String(args[0]).endsWith(String(args[1] ?? "")) });
    this.globals.set("replace", { builtin: true, call: (args) => String(args[0]).replace(String(args[1] ?? ""), String(args[2] ?? "")) });

    // Number helpers
    this.globals.set("number", { builtin: true, call: (args) => Number(args[0]) });
    this.globals.set("parseInt", { builtin: true, call: (args) => parseInt(String(args[0]), args.length > 1 ? Number(args[1]) : 10) });
    this.globals.set("parseFloat", { builtin: true, call: (args) => parseFloat(String(args[0])) });
    this.globals.set("isNaN", { builtin: true, call: (args) => Number.isNaN(Number(args[0])) });

    // IO helpers
    this.globals.set("read_json", { builtin: true, call: (args) => JSON.parse(fs.readFileSync(path.resolve(this.baseDir, String(args[0])), "utf8")) });
    this.globals.set("write_json", { builtin: true, call: (args) => { fs.writeFileSync(path.resolve(this.baseDir, String(args[0])), JSON.stringify(args[1], null, 2), "utf8"); return null; }});
    this.globals.set("join_path", { builtin: true, call: (args) => path.join(...args.map(a => String(a))) });

    // Process helpers
    this.globals.set("env", { builtin: true, call: (args) => {
      if (args.length === 0) return process.env;
      return process.env[String(args[0])] ?? null;
    }});
    this.globals.set("set_env", { builtin: true, call: (args) => { process.env[String(args[0])] = String(args[1]); return null; }});
    this.globals.set("argv", { builtin: true, call: () => process.argv.slice(2) });

    // Global setters/getters
    this.globals.set("global_set", { builtin: true, call: (args) => { this.globals.set(String(args[0]), args[1]); return null; }});
    this.globals.set("global_get", { builtin: true, call: (args) => this.globals.get(String(args[0])) ?? null });

    // json alias
    this.globals.set("json", { builtin: true, call: (args) => JSON.stringify(args[0], null, 2) });
  }

  // Helper to resolve a name in current frame or globals
  lookup(name) {
    // search frames from top to bottom for locals
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.locals && Object.prototype.hasOwnProperty.call(f.locals, name)) return f.locals[name];
    }
    if (this.globals.has(name)) return this.globals.get(name);
    return undefined;
  }

  // Helper to set a variable in the nearest frame or globals
  setVar(name, value) {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.locals && Object.prototype.hasOwnProperty.call(f.locals, name)) { f.locals[name] = value; return; }
    }
    // otherwise set global
    this.globals.set(name, value);
  }

  // Run the VM (async to support async builtins)
  async run() {
    // push global frame
    this.frames.push({ code: this.code, consts: this.consts, ip: 0, locals: {}, baseDir: this.baseDir, isGlobal: true });

    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1];
      const code = frame.code;
      while (frame.ip < code.length) {
        const inst = code[frame.ip++];
        if (!inst || !inst.op) continue;
        switch (inst.op) {
          case Op.CONST: {
            const v = frame.consts[inst.arg];
            this.stack.push(v);
            break;
          }
          case Op.LOAD: {
            const name = frame.consts[inst.arg];
            // If name is a string constant representing an identifier, try lookup
            if (typeof name === "string") {
              // support dotted math namespace lookup: e.g., math.sin
              if (name.includes(".") && this.globals.has(name)) {
                this.stack.push(this.globals.get(name));
              } else {
                const val = this.lookup(name);
                if (val === undefined) this.stack.push(null);
                else this.stack.push(val);
              }
            } else {
              // numeric or other constant
              this.stack.push(name);
            }
            break;
          }
          case Op.STORE: {
            const name = frame.consts[inst.arg];
            const val = this.stack.pop();
            // store in nearest frame or global
            if (frame.isGlobal) {
              this.globals.set(name, val);
            } else {
              frame.locals[name] = val;
            }
            break;
          }
          case Op.POP: {
            this.stack.pop();
            break;
          }
          case Op.ADD: {
            const b = this.stack.pop(); const a = this.stack.pop();
            if (typeof a === "string" || typeof b === "string") this.stack.push(String(a) + String(b));
            else this.stack.push(a + b);
            break;
          }
          case Op.SUB: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a - b); break; }
          case Op.MUL: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a * b); break; }
          case Op.DIV: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a / b); break; }
          case Op.MOD: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a % b); break; }
          case Op.EQ: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a === b); break; }
          case Op.NEQ: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a !== b); break; }
          case Op.LT: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a < b); break; }
          case Op.LTE: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a <= b); break; }
          case Op.GT: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a > b); break; }
          case Op.GTE: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a >= b); break; }
          case Op.NOT: { const a = this.stack.pop(); this.stack.push(!a); break; }

          case Op.NEWARRAY: {
            const n = inst.arg;
            const arr = [];
            for (let i = 0; i < n; i++) arr.unshift(this.stack.pop());
            this.stack.push(arr);
            break;
          }
          case Op.NEWOBJ: {
            const n = inst.arg;
            const obj = {};
            for (let i = 0; i < n; i++) {
              const val = this.stack.pop();
              const key = this.stack.pop();
              obj[key] = val;
            }
            this.stack.push(obj);
            break;
          }
          case Op.INDEX: {
            const idx = this.stack.pop();
            const target = this.stack.pop();
            if (Array.isArray(target)) this.stack.push(target[idx]);
            else if (target && typeof target === "object") this.stack.push(target[idx]);
            else this.stack.push(null);
            break;
          }
          case Op.SETINDEX: {
            const val = this.stack.pop();
            const idx = this.stack.pop();
            const target = this.stack.pop();
            if (Array.isArray(target)) target[idx] = val;
            else if (target && typeof target === "object") target[idx] = val;
            this.stack.push(val);
            break;
          }
          case Op.CALL: {
            const argc = inst.arg;
            const args = [];
            for (let i = 0; i < argc; i++) args.unshift(this.stack.pop());
            const callee = this.stack.pop();

            // builtin object with .call
            if (callee && callee.builtin && typeof callee.call === "function") {
              const res = callee.call(args);
              if (res && typeof res.then === "function") {
                const awaited = await res;
                this.stack.push(awaited);
              } else {
                this.stack.push(res);
              }
              break;
            }

            // If callee is a plain object with value property (like math namespace), not callable
            if (callee && typeof callee === "object" && !callee.builtin && callee.value) {
              // not callable
              this.stack.push(null);
              break;
            }

            // user function object: { params, code, consts }
            if (callee && typeof callee === "object" && callee.params && callee.code) {
              const newFrame = { code: callee.code, consts: callee.consts, ip: 0, locals: {}, baseDir: frame.baseDir, isGlobal: false };
              // bind params
              for (let i = 0; i < callee.params.length; i++) {
                newFrame.locals[callee.params[i]] = args[i];
              }
              this.frames.push(newFrame);
              // call: break into executing new frame
              break;
            }

            // If callee is a string name referencing a builtin or function
            if (typeof callee === "string") {
              const val = this.lookup(callee);
              if (val && val.builtin && typeof val.call === "function") {
                const res = val.call(args);
                if (res && typeof res.then === "function") {
                  const awaited = await res;
                  this.stack.push(awaited);
                } else {
                  this.stack.push(res);
                }
                break;
              }
              if (val && typeof val === "object" && val.params && val.code) {
                const newFrame = { code: val.code, consts: val.consts, ip: 0, locals: {}, baseDir: frame.baseDir, isGlobal: false };
                for (let i = 0; i < val.params.length; i++) newFrame.locals[val.params[i]] = args[i];
                this.frames.push(newFrame);
                break;
              }
            }

            // If callee is a plain JS function (rare), call it
            if (typeof callee === "function") {
              const res = callee(...args);
              if (res && typeof res.then === "function") {
                const awaited = await res;
                this.stack.push(awaited);
              } else {
                this.stack.push(res);
              }
              break;
            }

            // unknown callee
            this.stack.push(null);
            break;
          }

          case Op.RET: {
            // return value is on stack (optional)
            const retVal = this.stack.length ? this.stack.pop() : null;
            // pop current frame
            this.frames.pop();
            // push return value to previous frame's stack
            if (this.frames.length === 0) {
              // program returned from global frame -> end
              return;
            } else {
              this.stack.push(retVal);
              // continue executing caller frame
              break;
            }
          }

          case Op.JMP: {
            frame.ip = inst.arg;
            break;
          }
          case Op.JMPF: {
            const cond = this.stack.pop();
            if (!cond) frame.ip = inst.arg;
            break;
          }

          case Op.IMPORT: {
            // robust import implementation with caching and circular support
            const importFileConst = frame.consts[inst.arg];
            let importPath = String(importFileConst);

            // Resolve relative to current frame baseDir
            const currentBase = frame.baseDir || this.baseDir;
            let resolvedPath = importPath;
            if (!path.isAbsolute(importPath)) resolvedPath = path.resolve(currentBase, importPath);
            if (!path.extname(resolvedPath)) resolvedPath += ".vx";
            resolvedPath = path.normalize(resolvedPath);

            // If cached, push cached module object or wait for promise
            if (this.importCache.has(resolvedPath)) {
              const cached = this.importCache.get(resolvedPath);
              // support Promise stored during loading
              if (cached && typeof cached.then === "function") {
                const moduleObj = await cached;
                this.stack.push(moduleObj);
                break;
              } else {
                this.stack.push(cached);
                break;
              }
            }

            if (!fs.existsSync(resolvedPath)) {
              throw new Error("Import failed: file not found: " + resolvedPath);
            }

            // Create a promise placeholder and store it to handle circular imports
            const loadPromise = (async () => {
              const src = fs.readFileSync(resolvedPath, "utf8");
              const lexer = new Lexer(src);
              const tokens = lexer.lex();
              const parser = new Parser(tokens);
              const stmts = parser.parseProgram();
              const compiler = new Compiler();
              const compiled = compiler.compile(stmts);

              // Create child VM and run it
              const childVM = new VM(compiled.consts, compiled.code, { baseDir: path.dirname(resolvedPath), debug: this.debug });

              // Pre-cache an empty module object to allow circular references during execution
              const placeholder = {};
              this.importCache.set(resolvedPath, placeholder);

              await childVM.run();

              // Collect exported names from childVM.globals into a plain object
              const moduleObj = {};
              for (const [k, v] of childVM.globals.entries()) {
                moduleObj[k] = v;
              }

              // Replace placeholder with real module object
              this.importCache.set(resolvedPath, moduleObj);
              return moduleObj;
            })();

            // store promise while loading
            this.importCache.set(resolvedPath, loadPromise);
            const moduleObj = await loadPromise;
            this.stack.push(moduleObj);
            break;
          }

          case Op.HALT: {
            // end of this frame/program
            this.frames.pop();
            if (this.frames.length === 0) return;
            break;
          }

          default:
            throw new Error("Unknown opcode: " + inst.op);
        } // end switch
      } // end while frame.ip < code.length
    } // end while frames
  } // end run
} // end VM

module.exports = { Lexer, Parser, Compiler, VM };
