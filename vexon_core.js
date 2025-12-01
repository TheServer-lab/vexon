"use strict";
/*
  vexon_core.js — Updated with Exception Handling (try/catch) and working IMPORT

  Changes:
  - Implemented Op.IMPORT handler in VM to read, compile, run imported .vx files and return a module object.
  - Implemented TRY_PUSH, TRY_POP, THROW semantics with stack unwinding across frames.
  - Implemented CALL/RET, GET/SET index/prop, SETPROP, SETINDEX behavior.
  - Completed builtins (toString, fetch fallback).
*/

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

// Optional readline-sync
let readlineSync = null;
try { readlineSync = require("readline-sync"); } catch (e) { readlineSync = null; }

// node-fetch fallback
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
        // UPDATED: Added try, catch, throw and func/function synonyms
        if (["true","false","null","in","for","let","fn","func","function","return","if","else","while","break","continue","import","as","try","catch","throw"].includes(id))
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
    // Accept fn, func, or function
    if (this.peek().t === "keyword" && (this.peek().v === "fn" || this.peek().v === "func" || this.peek().v === "function")) return this.parseFn();
    // UPDATED: Handle try/throw
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

  // UPDATED: New parseTry method
  parseTry() {
    this.next(); // consume try
    if (!this.matchSymbol("{")) throw new Error("try missing {");
    const tryBody = [];
    while (!this.matchSymbol("}")) tryBody.push(this.parseStmt());

    if (!this.matchKeyword("catch")) throw new Error("expected catch after try");
    
    let errVar = null;
    if (this.matchSymbol("(")) {
      if (this.peek().t !== "id") throw new Error("catch expects identifier");
      errVar = this.next().v;
      if (!this.matchSymbol(")")) throw new Error("catch missing )");
    }

    if (!this.matchSymbol("{")) throw new Error("catch missing {");
    const catchBody = [];
    while (!this.matchSymbol("}")) catchBody.push(this.parseStmt());

    return { kind: "try", tryBody, errVar, catchBody };
  }

  // UPDATED: New parseThrow method
  parseThrow() {
    this.next(); // consume throw
    const expr = this.parseExpr();
    if (this.matchSymbol(";")) {}
    return { kind: "throw", expr };
  }

  parseImport() {
    this.next(); 
    const tk = this.peek();
    if (tk.t !== "string") throw new Error("import expects a string literal");
    const file = this.next().v;
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
    this.next(); 
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
          // Accept id, string, number, or true/false/null as keys
          if (keytk.t === "id") {
            key = this.next().v;
          } else if (keytk.t === "string") {
            key = this.next().v;
          } else if (keytk.t === "number") {
            // numeric keys allowed — treat as string key
            key = this.next().v;
          } else if (keytk.t === "keyword" && (keytk.v === "true" || keytk.v === "false" || keytk.v === "null")) {
            key = this.next().v;
          } else {
            throw new Error("object key must be identifier, string, or number — got " + keytk.t + (keytk.v ? (":" + keytk.v) : ""));
          }

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
  IMPORT: "IMPORT",
  // UPDATED: New Opcodes for exceptions
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
      // UPDATED: Compile try/catch
      case "try": {
        // We need to jump to catch block if error occurs.
        // We'll emit TRY_PUSH (arg=catchAddr).
        // Since we don't know catchAddr yet, we keep a reference.
        
        const tryPushIdx = this.code.length;
        this.emit({ op: Op.TRY_PUSH, arg: null }); // Placeholder
        
        // Compile try block
        for (const st of s.tryBody) this.emitStmt(st);
        
        // If we get here, try finished successfully.
        this.emit({ op: Op.TRY_POP }); // Pop the handler
        const skipCatchIdx = this.code.length;
        this.emit({ op: Op.JMP, arg: null }); // Jump over catch block
        
        // Catch Block Starts Here
        const catchStart = this.code.length;
        this.code[tryPushIdx].arg = catchStart; // Patch TRY_PUSH
        
        // When VM jumps here, the Exception Object is pushed onto stack.
        // We must store it in the error variable if one was defined.
        if (s.errVar) {
          this.emit({ op: Op.STORE, arg: this.addConst(s.errVar) });
        } else {
          this.emit({ op: Op.POP }); // Discard error if no variable provided
        }
        
        for (const st of s.catchBody) this.emitStmt(st);
        
        // End of catch block
        const afterCatch = this.code.length;
        this.code[skipCatchIdx].arg = afterCatch; // Patch skip jump
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

    // frames: each frame = { code, consts, ip, locals: Map(), baseDir, isGlobal, tryStack: [] }
    // tryStack items: { catchIp, stackHeight }
    this.frames = [];
    this.stack = [];
    this.globals = new Map();
    this.importedFiles = new Set();
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
      // return a promise-like object? We'll return a simple wrapper that resolves to text synchronously is not possible.
      // For simplicity, return a Promise so user code can handle it via then/callbacks if supported.
      return fetchImpl(url, opts).then(res => res.text());
    }});
  }

  // Helper to push a value onto stack
  push(v) { this.stack.push(v); }
  pop() { return this.stack.pop(); }

  // Resolve a name: check locals of current frame, then globals
  resolveName(frame, name) {
    if (frame && frame.locals && frame.locals.has(name)) return frame.locals.get(name);
    if (this.globals.has(name)) return this.globals.get(name);
    return undefined;
  }

  // Set a global/local variable
  setName(frame, name, value) {
    if (frame && frame.isGlobal === false && frame.locals && frame.locals.has(name)) {
      frame.locals.set(name, value);
      return;
    }
    // If current frame is function frame, set in locals
    if (frame && frame.isGlobal === false && frame.locals) {
      frame.locals.set(name, value);
      return;
    }
    // Otherwise set global
    this.globals.set(name, value);
  }

  // Run the VM (async because imports and fetch may be async)
  async run() {
    // push initial global frame
    const globalFrame = {
      code: this.code,
      consts: this.consts,
      ip: 0,
      locals: new Map(),
      baseDir: this.baseDir,
      isGlobal: true,
      tryStack: []
    };
    this.frames.push(globalFrame);

    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1];
      const code = frame.code;
      if (frame.ip >= code.length) {
        // No more instructions in this frame: pop it
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
            // If storing into a function-local frame, store there; otherwise global
            if (frame.isGlobal) this.globals.set(name, val);
            else frame.locals.set(name, val);
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
          case Op.SEPROP:
          case Op.SETPROP: {
            // Stack: ... targetObj, key, value
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
            // arg is a const string path
            const fileConst = frame.consts[inst.arg];
            // Resolve relative to current frame baseDir
            const full = path.resolve(frame.baseDir || this.baseDir, fileConst);
            if (this.importCache.has(full)) {
              this.push(this.importCache.get(full));
              break;
            }
            if (!fs.existsSync(full)) {
              // Try adding .vx
              if (fs.existsSync(full + ".vx")) {
                full = full + ".vx";
              } else {
                throw new Error("Import file not found: " + full);
              }
            }
            const src = fs.readFileSync(full, "utf8");
            // Lex/parse/compile
            const lexer = new Lexer(src);
            const tokens = lexer.lex();
            const parser = new Parser(tokens);
            const stmts = parser.parseProgram();
            const compiler = new Compiler();
            const compiled = compiler.compile(stmts);
            // Create child VM and run it
            const childVM = new VM(compiled.consts, compiled.code, { baseDir: path.dirname(full), debug: this.debug });
            // Share builtins by copying them into child's globals so builtins exist
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
              // If res is a Promise, await it
              if (res && typeof res.then === "function") {
                const awaited = await res;
                this.push(awaited);
              } else {
                this.push(res);
              }
              break;
            }
            // User function object: { params, code, consts }
            if (callee && callee.code && Array.isArray(callee.code)) {
              const funcFrame = {
                code: callee.code,
                consts: callee.consts,
                ip: 0,
                locals: new Map(),
                baseDir: frame.baseDir, // inherit baseDir
                isGlobal: false,
                tryStack: []
              };
              // bind params
              for (let i = 0; i < (callee.params ? callee.params.length : 0); i++) {
                const pname = callee.params[i];
                funcFrame.locals.set(pname, args[i]);
              }
              // push frame
              this.frames.push(funcFrame);
              break;
            }
            // If callee is a plain JS function (unlikely), call it
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
            // Pop return value if present
            const retVal = this.stack.length ? this.pop() : undefined;
            // Pop current frame
            this.frames.pop();
            // If there is a caller frame, push return value
            if (this.frames.length > 0) {
              this.push(retVal);
            } else {
              // No caller: end execution
              return retVal;
            }
            break;
          }
          case Op.HALT: {
            // Stop execution entirely
            return null;
          }
          case Op.NOT: {
            const v = this.pop();
            this.push(!v);
            break;
          }
          case Op.TRY_PUSH: {
            // arg is catchIp
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
            // Unwind frames until a handler is found
            let handled = false;
            while (this.frames.length > 0) {
              const cur = this.frames[this.frames.length - 1];
              if (cur.tryStack && cur.tryStack.length > 0) {
                const handler = cur.tryStack.pop();
                // Reset stack to handler.stackHeight and push exception
                this.stack.length = handler.stackHeight;
                this.stack.push(ex);
                // Set ip to handler.catchIp in that frame
                cur.ip = handler.catchIp;
                handled = true;
                break;
              } else {
                // No handler in this frame: pop it
                this.frames.pop();
              }
            }
            if (!handled) {
              // Uncaught exception: throw to host
              throw new Error("Uncaught exception: " + (ex && ex.message ? ex.message : String(ex)));
            }
            break;
          }
          default:
            throw new Error("Unknown opcode: " + inst.op);
        }
      } catch (err) {
        // If an error occurs during instruction execution, attempt to unwind using TRY stacks
        // Create an exception object
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
          // No handler found: rethrow to host
          throw err;
        }
      }
    } // end while frames
    return null;
  }
}

module.exports = { Lexer, Parser, Compiler, VM, Op };
