"use strict";
/*
  vexon_core.js — Import environment fix + diagnostics + circular JSON avoidance

  - Imported module functions now carry a non-enumerable reference to their module object
    (so JSON.stringify / toString won't hit a circular reference).
  - Function frames created for imported functions get a `module` field.
  - resolveName and STORE respect frame.module so module globals are visible to functions.
  - Lexer/Parser include token positions and improved error messages for easier debugging.
*/

const fs = require("fs");
const path = require("path");

// Optional readline-sync
let readlineSync = null;
try { readlineSync = require("readline-sync"); } catch (e) { readlineSync = null; }

// node-fetch fallback
let fetchImpl = globalThis.fetch;
if (!fetchImpl) {
  try { fetchImpl = require("node-fetch"); } catch (e) { fetchImpl = null; }
}

/* ---------------- Lexer (with line/col) ---------------- */
function isAlpha(c) { return /[A-Za-z_]/.test(c); }
function isDigit(c) { return /[0-9]/.test(c); }

class Lexer {
  constructor(src) {
    this.src = src;
    this.i = 0;
    this.line = 1;
    this.col = 1;
  }
  peek() { return this.src[this.i] ?? "\0"; }
  next() {
    const ch = this.src[this.i++] ?? "\0";
    if (ch === "\n") { this.line++; this.col = 1; }
    else this.col++;
    return ch;
  }
  eof() { return this.i >= this.src.length; }

  makeToken(t, v, startLine, startCol, startIdx) {
    return { t, v, line: startLine, col: startCol, idx: startIdx };
  }

  lex() {
    const out = [];
    while (!this.eof()) {
      let c = this.peek();
      if (/\s/.test(c)) { this.next(); continue; }
      if (c === "/" && this.src[this.i + 1] === "/") {
        while (!this.eof() && this.peek() !== "\n") this.next();
        continue;
      }

      const startLine = this.line;
      const startCol = this.col;
      const startIdx = this.i;

      // triple-char operators
      if ((c === "=" && this.src[this.i + 1] === "=" && this.src[this.i + 2] === "=")) {
        const v = this.next() + this.next() + this.next();
        out.push(this.makeToken("symbol", v, startLine, startCol, startIdx));
        continue;
      }
      if ((c === "!" && this.src[this.i + 1] === "=" && this.src[this.i + 2] === "=")) {
        const v = this.next() + this.next() + this.next();
        out.push(this.makeToken("symbol", v, startLine, startCol, startIdx));
        continue;
      }

      // two-char symbols
      if ((c === ">" || c === "<" || c === "=" || c === "!") && this.src[this.i + 1] === "=") {
        const v = this.next() + this.next();
        out.push(this.makeToken("symbol", v, startLine, startCol, startIdx));
        continue;
      }
      if (c === "&" && this.src[this.i + 1] === "&") {
        const v = this.next() + this.next();
        out.push(this.makeToken("symbol", v, startLine, startCol, startIdx));
        continue;
      }
      if (c === "|" && this.src[this.i + 1] === "|") {
        const v = this.next() + this.next();
        out.push(this.makeToken("symbol", v, startLine, startCol, startIdx));
        continue;
      }

      if (isDigit(c)) {
        let num = "";
        while (!this.eof() && (isDigit(this.peek()) || this.peek() === ".")) num += this.next();
        out.push(this.makeToken("number", num, startLine, startCol, startIdx));
        continue;
      }

      if (c === '"' || c === "'") {
        const q = this.next();
        let s = "";
        while (!this.eof() && this.peek() !== q) {
          let ch = this.next();
          if (ch === "\\") {
            const n = this.next();
            if (n === "n") s += "\n"; else if (n === "t") s += "\t"; else s += n;
          } else s += ch;
        }
        if (this.peek() === q) this.next();
        out.push(this.makeToken("string", s, startLine, startCol, startIdx));
        continue;
      }

      if (isAlpha(c)) {
        let id = "";
        while (!this.eof() && /[A-Za-z0-9_]/.test(this.peek())) id += this.next();
        const keywords = ["true","false","null","in","for","let","fn","func","function","return","if","else","while","break","continue","import","as","try","catch","throw"];
        if (keywords.includes(id)) out.push(this.makeToken("keyword", id, startLine, startCol, startIdx));
        else out.push(this.makeToken("id", id, startLine, startCol, startIdx));
        continue;
      }

      out.push(this.makeToken("symbol", this.next(), startLine, startCol, startIdx));
    }
    out.push(this.makeToken("eof", "", this.line, this.col, this.i));
    return out;
  }
}

/* ---------------- Parser (with source for context) ---------------- */
class Parser {
  constructor(tokens, src = "") {
    this.tokens = tokens;
    this.i = 0;
    this.src = src;
  }
  peek() { return this.tokens[this.i]; }
  next() { return this.tokens[this.i++]; }
  matchSymbol(v) { if (this.peek().t === "symbol" && this.peek().v === v) { this.next(); return true; } return false; }
  matchId(v) { if (this.peek().t === "id" && (v === undefined || this.peek().v === v)) { this.next(); return true; } return false; }
  matchKeyword(v) { if (this.peek().t === "keyword" && this.peek().v === v) { this.next(); return true; } return false; }

  formatTokenError(tok, note) {
    const lines = this.src.split(/\r?\n/);
    const lineText = (lines[tok.line - 1] ?? "").replace(/\t/g, " ");
    const caret = " ".repeat(Math.max(0, tok.col - 1)) + "^";
    const tokenJson = JSON.stringify({ t: tok.t, v: tok.v, line: tok.line, col: tok.col });
    return `${note}\nToken: ${tokenJson}\nAt ${tok.line}:${tok.col}\n${lineText}\n${caret}`;
  }

  parseProgram() { const out = []; while (this.peek().t !== "eof") out.push(this.parseStmt()); return out; }

  parseStmt() {
    if (this.peek().t === "keyword" && this.peek().v === "let") return this.parseLet();
    if (this.peek().t === "keyword" && this.peek().v === "return") return this.parseReturn();
    if (this.peek().t === "keyword" && this.peek().v === "if") return this.parseIf();
    if (this.peek().t === "keyword" && this.peek().v === "while") return this.parseWhile();
    if (this.peek().t === "keyword" && this.peek().v === "for") return this.parseFor();
    if (this.peek().t === "keyword" && this.peek().v === "import") return this.parseImport();
    if (this.peek().t === "keyword" && (this.peek().v === "fn" || this.peek().v === "func" || this.peek().v === "function")) return this.parseFn();
    if (this.peek().t === "keyword" && this.peek().v === "try") return this.parseTry();
    if (this.peek().t === "keyword" && this.peek().v === "throw") return this.parseThrow();

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

  parseTry() {
    this.next();
    if (!this.matchSymbol("{")) throw new Error(this.formatTokenError(this.peek(), "try missing {"));
    const tryBody = [];
    while (!this.matchSymbol("}")) tryBody.push(this.parseStmt());

    if (!this.matchKeyword("catch")) throw new Error(this.formatTokenError(this.peek(), "expected catch after try"));

    let errVar = null;
    if (this.matchSymbol("(")) {
      if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "catch expects identifier"));
      errVar = this.next().v;
      if (!this.matchSymbol(")")) throw new Error(this.formatTokenError(this.peek(), "catch missing )"));
    }

    if (!this.matchSymbol("{")) throw new Error(this.formatTokenError(this.peek(), "catch missing {"));
    const catchBody = [];
    while (!this.matchSymbol("}")) catchBody.push(this.parseStmt());

    return { kind: "try", tryBody, errVar, catchBody };
  }

  parseThrow() {
    this.next();
    const expr = this.parseExpr();
    if (this.matchSymbol(";")) {}
    return { kind: "throw", expr };
  }

  parseImport() {
    this.next();
    const tk = this.peek();
    if (tk.t !== "string") throw new Error(this.formatTokenError(tk, "import expects a string literal"));
    const file = this.next().v;
    let alias = null;
    if (this.peek().t === "keyword" && this.peek().v === "as") {
      this.next();
      if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "import 'as' expects identifier"));
      alias = this.next().v;
    }
    if (this.matchSymbol(";")) {}
    return { kind: "import", file, alias };
  }

  parseFn() {
    this.next();
    if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "fn expects a name"));
    const name = this.next().v;

    if (!this.matchSymbol("(")) throw new Error(this.formatTokenError(this.peek(), "fn missing ("));
    const params = [];
    if (!this.matchSymbol(")")) {
      while (true) {
        if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "fn param must be identifier"));
        params.push(this.next().v);
        if (this.matchSymbol(")")) break;
        if (!this.matchSymbol(",")) throw new Error(this.formatTokenError(this.peek(), "expected , or )"));
      }
    }

    if (!this.matchSymbol("{")) throw new Error(this.formatTokenError(this.peek(), "fn missing {"));
    const body = [];
    while (!this.matchSymbol("}")) body.push(this.parseStmt());

    return { kind: "fn", name, params, body };
  }

  parseLet() {
    this.next();
    if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "let expects identifier"));
    const name = this.next().v;
    if (!this.matchSymbol("=")) throw new Error(this.formatTokenError(this.peek(), "let missing ="));
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
    if (!this.matchSymbol("{")) throw new Error(this.formatTokenError(this.peek(), "if missing {"));
    const then = [];
    while (!this.matchSymbol("}")) then.push(this.parseStmt());
    let otherwise = [];
    if (this.peek().t === "keyword" && this.peek().v === "else") {
      this.next();
      if (!this.matchSymbol("{")) throw new Error(this.formatTokenError(this.peek(), "else missing {"));
      while (!this.matchSymbol("}")) otherwise.push(this.parseStmt());
    }
    return { kind: "if", cond, then, otherwise };
  }

  parseWhile() {
    this.next();
    const cond = this.parseExpr();
    if (!this.matchSymbol("{")) throw new Error(this.formatTokenError(this.peek(), "while missing {"));
    const body = [];
    while (!this.matchSymbol("}")) body.push(this.parseStmt());
    return { kind: "while", cond, body };
  }

  parseFor() {
    this.next();
    if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "for expects identifier"));
    const iterator = this.next().v;
    if (!(this.peek().t === "keyword" && this.peek().v === "in")) throw new Error(this.formatTokenError(this.peek(), "for missing 'in'"));
    this.next();
    const iterable = this.parseExpr();
    if (!this.matchSymbol("{")) throw new Error(this.formatTokenError(this.peek(), "for missing {"));
    const body = [];
    while (!this.matchSymbol("}")) body.push(this.parseStmt());
    return { kind: "for", iterator, iterable, body };
  }

  parseExpr() { return this.parseBinary(0); }

  precedence(op) {
    return {
      "||":1, "&&":2,
      "==":3, "!=":3, "===":3, "!==":3,
      ">":4, "<":4, ">=":4, "<=":4,
      "+":5, "-":5, "*":6, "/":6, "%":6
    }[op] || 0;
  }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    while (true) {
      const tk = this.peek();
      let op = null;
      if (tk.t === "symbol" && ["+","-","*","/","%","==","!=","===","!==","<","<=",">",">=","&&","||"].includes(tk.v)) op = tk.v;
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
    if (!tk) throw new Error("Unexpected end of input in primary");
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
          if (!this.matchSymbol(",")) throw new Error(this.formatTokenError(this.peek(), "expected , or ] in array"));
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
          if (keytk.t === "id") {
            key = this.next().v;
          } else if (keytk.t === "string") {
            key = this.next().v;
          } else if (keytk.t === "number") {
            key = this.next().v;
          } else if (keytk.t === "keyword" && (keytk.v === "true" || keytk.v === "false" || keytk.v === "null")) {
            key = this.next().v;
          } else {
            throw new Error(this.formatTokenError(keytk, "object key must be identifier, string, or number"));
          }

          if (!this.matchSymbol(":")) throw new Error(this.formatTokenError(this.peek(), "object entry missing :"));
          const val = this.parseExpr();
          entries.push({ key, value: val });
          if (this.matchSymbol("}")) break;
          if (!this.matchSymbol(",")) throw new Error(this.formatTokenError(this.peek(), "expected , or } in object"));
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
              if (!this.matchSymbol(",")) throw new Error(this.formatTokenError(this.peek(), "expected , or )"));
            }
          } else { this.next(); }
          node = { kind: "call", callee: node, args };
          continue;
        }
        if (this.peek().t === "symbol" && this.peek().v === "[") {
          this.next();
          const idx = this.parseExpr();
          if (!this.matchSymbol("]")) throw new Error(this.formatTokenError(this.peek(), "missing ]"));
          node = { kind: "index", target: node, index: idx };
          continue;
        }
        if (this.peek().t === "symbol" && this.peek().v === ".") {
          this.next();
          if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "expected property name after ."));
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
      if (!this.matchSymbol(")")) throw new Error(this.formatTokenError(this.peek(), "missing )"));
      return e;
    }

    throw new Error(this.formatTokenError(tk, "Unexpected token in primary"));
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
  TRY_PUSH: "TRY_PUSH", TRY_POP: "TRY_POP", THROW: "THROW"
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
        const bytecode = subCompiler.compile(s.body);
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
      case "try": {
        const tryPushIdx = this.code.length;
        this.emit({ op: Op.TRY_PUSH, arg: null });
        for (const st of s.tryBody) this.emitStmt(st);
        this.emit({ op: Op.TRY_POP });
        const skipCatchIdx = this.code.length;
        this.emit({ op: Op.JMP, arg: null });
        const catchStart = this.code.length;
        this.code[tryPushIdx].arg = catchStart;
        if (s.errVar) {
          this.emit({ op: Op.STORE, arg: this.addConst(s.errVar) });
        } else {
          this.emit({ op: Op.POP });
        }
        for (const st of s.catchBody) this.emitStmt(st);
        const afterCatch = this.code.length;
        this.code[skipCatchIdx].arg = afterCatch;
        break;
      }
      case "throw": {
        this.emitExpr(s.expr);
        this.emit({ op: Op.THROW });
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
          case "==":
          case "===": this.emit({ op: Op.EQ }); break;
          case "!=":
          case "!==": this.emit({ op: Op.NEQ }); break;
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

/* ---------------- VM (with module env support and circular-safe import) ---------------- */
class VM {
  constructor(consts = [], code = [], options = {}) {
    this.consts = Array.from(consts);
    this.code = Array.from(code);

    // frames: { code, consts, ip, locals: Map(), baseDir, isGlobal, tryStack: [], module: object|null }
    this.frames = [];
    this.stack = [];
    this.globals = new Map();
    this.importCache = new Map();
    this.baseDir = options.baseDir || process.cwd();
    this.debug = !!options.debug;

    this.setupBuiltins();
  }

  setupBuiltins() {
    this.globals.set("print", { builtin: true, call: (args) => { console.log(...args.map(a => (a === null ? "null" : a))); return null; } });
    this.globals.set("len", { builtin: true, call: (args) => {
      const v = args[0];
      if (Array.isArray(v) || typeof v === "string") return v.length;
      if (v && typeof v === "object") return Object.keys(v).length;
      return 0;
    }});
    this.globals.set("range", { builtin: true, call: (args) => {
      let start = 0, end = 0;
      if (args.length === 1) { end = args[0]; }
      else if (args.length >= 2) { start = args[0]; end = args[1]; }
      const out = []; for (let i = start; i < end; i++) out.push(i); return out;
    }});
    this.globals.set("push", { builtin: true, call: (args) => { const a = args[0]; a.push(args[1]); return a.length; }});
    this.globals.set("pop", { builtin: true, call: (args) => { const a = args[0]; return a.pop(); }});
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
    this.globals.set("json_encode", { builtin: true, call: (args) => JSON.stringify(args[0], null, 2) });
    this.globals.set("json_decode", { builtin: true, call: (args) => JSON.parse(String(args[0])) });
    this.globals.set("time", { builtin: true, call: () => Date.now() });
    this.globals.set("random", { builtin: true, call: () => Math.random() });
    this.globals.set("toString", { builtin: true, call: (args) => {
      const obj = args[0];
      if (obj === null) return "null";
      if (Array.isArray(obj)) return "[" + obj.map(item => (item === null ? "null" : (typeof item === "object" ? JSON.stringify(item) : String(item)))).join(", ") + "]";
      if (typeof obj === "object") return JSON.stringify(obj, null, 2);
      return String(obj);
    }});
    this.globals.set("fetch", { builtin: true, call: (args) => {
      if (!fetchImpl) throw new Error("fetch not available in this environment");
      const url = String(args[0]);
      const opts = args[1] || {};
      return fetchImpl(url, opts).then(res => res.text());
    }});
  }

  push(v) { this.stack.push(v); }
  pop() { return this.stack.pop(); }

  // Resolve a name: locals -> module (frame.module) -> globals
  resolveName(frame, name) {
    if (frame && frame.locals && frame.locals.has(name)) return frame.locals.get(name);
    if (frame && frame.module && Object.prototype.hasOwnProperty.call(frame.module, name)) return frame.module[name];
    if (this.globals.has(name)) return this.globals.get(name);
    return undefined;
  }

  // Set a name: prefer locals, then module (if present), else globals
  setName(frame, name, value) {
    if (frame && frame.locals && frame.locals.has(name)) {
      frame.locals.set(name, value);
      return;
    }
    if (frame && frame.module) {
      // store into module globals
      frame.module[name] = value;
      return;
    }
    this.globals.set(name, value);
  }

  async run() {
    const globalFrame = {
      code: this.code,
      consts: this.consts,
      ip: 0,
      locals: new Map(),
      baseDir: this.baseDir,
      isGlobal: true,
      tryStack: [],
      module: null
    };
    this.frames.push(globalFrame);

    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1];
      const code = frame.code;
      if (frame.ip >= code.length) {
        this.frames.pop();
        continue;
      }
      const inst = code[frame.ip++];
      if (this.debug) console.log("IP", frame.ip - 1, inst.op, inst.arg ?? "");
      try {
        switch (inst.op) {
          case Op.CONST: {
            const v = frame.consts[inst.arg];
            this.push(v);
            break;
          }
          case Op.LOAD: {
            const name = frame.consts[inst.arg];
            const val = this.resolveName(frame, name);
            this.push(val);
            break;
          }
          case Op.STORE: {
            const name = frame.consts[inst.arg];
            const val = this.pop();
            // If current frame is a function frame with locals that already contain the name, set there.
            if (frame.locals && frame.locals.has(name)) {
              frame.locals.set(name, val);
            } else if (frame.module) {
              // store into module globals
              frame.module[name] = val;
            } else {
              this.globals.set(name, val);
            }
            break;
          }
          case Op.POP: {
            this.pop();
            break;
          }
          case Op.ADD: {
            const b = this.pop(); const a = this.pop();
            this.push(a + b);
            break;
          }
          case Op.SUB: {
            const b = this.pop(); const a = this.pop();
            this.push(a - b);
            break;
          }
          case Op.MUL: {
            const b = this.pop(); const a = this.pop();
            this.push(a * b);
            break;
          }
          case Op.DIV: {
            const b = this.pop(); const a = this.pop();
            this.push(a / b);
            break;
          }
          case Op.MOD: {
            const b = this.pop(); const a = this.pop();
            this.push(a % b);
            break;
          }
          case Op.EQ: {
            const b = this.pop(); const a = this.pop();
            this.push(a === b);
            break;
          }
          case Op.NEQ: {
            const b = this.pop(); const a = this.pop();
            this.push(a !== b);
            break;
          }
          case Op.LT: {
            const b = this.pop(); const a = this.pop();
            this.push(a < b);
            break;
          }
          case Op.LTE: {
            const b = this.pop(); const a = this.pop();
            this.push(a <= b);
            break;
          }
          case Op.GT: {
            const b = this.pop(); const a = this.pop();
            this.push(a > b);
            break;
          }
          case Op.GTE: {
            const b = this.pop(); const a = this.pop();
            this.push(a >= b);
            break;
          }
          case Op.JMP: {
            frame.ip = inst.arg;
            break;
          }
          case Op.JMPF: {
            const cond = this.pop();
            if (!cond) frame.ip = inst.arg;
            break;
          }
          case Op.NEWARRAY: {
            const n = inst.arg;
            const arr = [];
            for (let i = 0; i < n; i++) {
              arr.unshift(this.pop());
            }
            this.push(arr);
            break;
          }
          case Op.NEWOBJ: {
            const n = inst.arg;
            const obj = {};
            for (let i = 0; i < n; i++) {
              const val = this.pop();
              const key = this.pop();
              obj[key] = val;
            }
            this.push(obj);
            break;
          }
          case Op.INDEX: {
            const idx = this.pop();
            const target = this.pop();
            try {
              this.push(target[idx]);
            } catch (e) {
              this.push(undefined);
            }
            break;
          }
          case Op.SETINDEX: {
            const val = this.pop();
            const idx = this.pop();
            const target = this.pop();
            if (target && (Array.isArray(target) || typeof target === "object")) {
              target[idx] = val;
            }
            this.push(val);
            break;
          }
          case Op.SETPROP: {
            const val = this.pop();
            const key = this.pop();
            const target = this.pop();
            if (target && typeof target === "object") {
              target[key] = val;
            }
            this.push(val);
            break;
          }
          case Op.IMPORT: {
            const fileConst = frame.consts[inst.arg];
            let full = path.resolve(frame.baseDir || this.baseDir, fileConst);
            if (this.importCache.has(full)) {
              this.push(this.importCache.get(full));
              break;
            }
            if (!fs.existsSync(full)) {
              if (fs.existsSync(full + ".vx")) {
                full = full + ".vx";
              } else {
                throw new Error("Import file not found: " + full);
              }
            }
            const src = fs.readFileSync(full, "utf8");
            const lexer = new Lexer(src);
            const tokens = lexer.lex();
            const parser = new Parser(tokens, src);
            const stmts = parser.parseProgram();
            const compiler = new Compiler();
            const compiled = compiler.compile(stmts);

            // Run compiled code in a child VM to populate its globals
            const childVM = new VM(compiled.consts, compiled.code, { baseDir: path.dirname(full), debug: this.debug });
            // copy builtins into child so imported module can use them
            for (const [k, v] of this.globals.entries()) {
              if (v && v.builtin) childVM.globals.set(k, v);
            }
            await childVM.run();

            // Build module object from child's globals (exclude builtins)
            const moduleObj = {};
            for (const [k, v] of childVM.globals.entries()) {
              if (v && v.builtin) continue;
              moduleObj[k] = v;
            }

            // Annotate exported functions with a non-enumerable reference to their module object
            for (const k of Object.keys(moduleObj)) {
              const v = moduleObj[k];
              if (v && typeof v === "object" && Array.isArray(v.code)) {
                try {
                  Object.defineProperty(v, "__module", {
                    value: moduleObj,
                    enumerable: false,
                    writable: false,
                    configurable: false
                  });
                } catch (e) {
                  // If defineProperty fails for any reason, fall back to plain assignment but avoid breaking
                  v.__module = moduleObj;
                }
              }
            }

            this.importCache.set(full, moduleObj);
            this.push(moduleObj);
            break;
          }
          case Op.CALL: {
            const argc = inst.arg || 0;
            const args = [];
            for (let i = 0; i < argc; i++) args.unshift(this.pop());
            const callee = this.pop();
            if (callee === undefined) throw new Error("Call of undefined");
            // Builtin
            if (callee && callee.builtin && typeof callee.call === "function") {
              const res = callee.call(args);
              if (res && typeof res.then === "function") {
                const awaited = await res;
                this.push(awaited);
              } else {
                this.push(res);
              }
              break;
            }
            // User function object: { params, code, consts, __module? }
            if (callee && callee.code && Array.isArray(callee.code)) {
              const funcFrame = {
                code: callee.code,
                consts: callee.consts,
                ip: 0,
                locals: new Map(),
                baseDir: frame.baseDir,
                isGlobal: false,
                tryStack: [],
                module: callee.__module || null
              };
              // bind params
              for (let i = 0; i < (callee.params ? callee.params.length : 0); i++) {
                const pname = callee.params[i];
                funcFrame.locals.set(pname, args[i]);
              }
              this.frames.push(funcFrame);
              break;
            }
            // Plain JS function
            if (typeof callee === "function") {
              const res = callee(...args);
              if (res && typeof res.then === "function") {
                const awaited = await res;
                this.push(awaited);
              } else {
                this.push(res);
              }
              break;
            }
            throw new Error("Unsupported call target");
          }
          case Op.RET: {
            const retVal = this.stack.length ? this.pop() : undefined;
            this.frames.pop();
            if (this.frames.length > 0) {
              this.push(retVal);
            } else {
              return retVal;
            }
            break;
          }
          case Op.HALT: {
            return null;
          }
          case Op.NOT: {
            const v = this.pop();
            this.push(!v);
            break;
          }
          case Op.TRY_PUSH: {
            const catchIp = inst.arg;
            const stackHeight = this.stack.length;
            frame.tryStack.push({ catchIp, stackHeight });
            break;
          }
          case Op.TRY_POP: {
            frame.tryStack.pop();
            break;
          }
          case Op.THROW: {
            const ex = this.pop();
            let handled = false;
            while (this.frames.length > 0) {
              const cur = this.frames[this.frames.length - 1];
              if (cur.tryStack && cur.tryStack.length > 0) {
                const handler = cur.tryStack.pop();
                this.stack.length = handler.stackHeight;
                this.stack.push(ex);
                cur.ip = handler.catchIp;
                handled = true;
                break;
              } else {
                this.frames.pop();
              }
            }
            if (!handled) {
              throw new Error("Uncaught exception: " + (ex && ex.message ? ex.message : String(ex)));
            }
            break;
          }
          default:
            throw new Error("Unknown opcode: " + inst.op);
        }
      } catch (err) {
        const exObj = { message: err.message || String(err), _native: err };
        let handled = false;
        while (this.frames.length > 0) {
          const cur = this.frames[this.frames.length - 1];
          if (cur.tryStack && cur.tryStack.length > 0) {
            const handler = cur.tryStack.pop();
            this.stack.length = handler.stackHeight;
            this.stack.push(exObj);
            cur.ip = handler.catchIp;
            handled = true;
            break;
          } else {
            this.frames.pop();
          }
        }
        if (!handled) {
          throw err;
        }
      }
    }
    return null;
  }
}

module.exports = { Lexer, Parser, Compiler, VM, Op };
