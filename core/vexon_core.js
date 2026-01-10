// vexon_core.js
// Vexon 0.4.1 – Complete core with type checker, HTTP server, and all builtins
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const url = require("url");
const querystring = require("querystring");

// Optional readline-sync for input()
let readlineSync = null;
try { readlineSync = require("readline-sync"); } catch (e) { readlineSync = null; }

// node-fetch fallback for fetch builtin
let fetchImpl = globalThis.fetch;
if (!fetchImpl) {
  try { fetchImpl = require("node-fetch"); } catch (e) { fetchImpl = null; }
}

/* ================ TYPE CHECKER ================ */

class TypeChecker {
  constructor(ast, options = {}) {
    this.ast = ast;
    this.strict = options.strict || false;
    this.errors = [];
    this.warnings = [];
    
    this.globalEnv = new Map();
    this.scopes = [];
    this.functions = new Map();
    this.classes = new Map();
    
    this.initBuiltinTypes();
  }

  initBuiltinTypes() {
    this.functions.set('print', { params: ['any'], returns: 'null', variadic: true });
    this.functions.set('len', { params: ['array|string|object'], returns: 'number' });
    this.functions.set('range', { params: ['number', 'number?'], returns: 'array<number>' });
    this.functions.set('push', { params: ['array', 'any'], returns: 'number' });
    this.functions.set('pop', { params: ['array'], returns: 'any' });
    this.functions.set('input', { params: ['string?'], returns: 'string' });
    this.functions.set('toString', { params: ['any'], returns: 'string' });
    this.functions.set('random', { params: [], returns: 'number' });
    this.functions.set('time', { params: [], returns: 'number' });
  }

  check() {
    try {
      for (const stmt of this.ast) {
        this.checkStmt(stmt);
      }
    } catch (e) {
      this.error(`Type checking failed: ${e.message}`);
    }
    
    return {
      errors: this.errors,
      warnings: this.warnings,
      success: this.errors.length === 0
    };
  }

  error(msg, loc) {
    this.errors.push({ message: msg, location: loc });
  }

  warn(msg, loc) {
    this.warnings.push({ message: msg, location: loc });
  }

  currentScope() {
    return this.scopes.length > 0 ? this.scopes[this.scopes.length - 1] : this.globalEnv;
  }

  pushScope() { this.scopes.push(new Map()); }
  popScope() { this.scopes.pop(); }

  getType(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    }
    return this.globalEnv.get(name);
  }

  setType(name, type) {
    this.currentScope().set(name, type);
  }

  checkStmt(stmt) {
    if (!stmt) return 'any';
    
    switch (stmt.kind) {
      case 'let': return this.checkLetStmt(stmt);
      case 'fn': return this.checkFnStmt(stmt);
      case 'class': return this.checkClassStmt(stmt);
      case 'assign': return this.checkAssignStmt(stmt);
      case 'if': return this.checkIfStmt(stmt);
      case 'while': return this.checkWhileStmt(stmt);
      case 'for': return this.checkForStmt(stmt);
      case 'return': return this.checkReturnStmt(stmt);
      case 'expr': return this.checkExpr(stmt.expr);
      case 'use': return 'any';
      case 'import': return 'any';
      case 'try': return this.checkTryStmt(stmt);
      case 'throw': return this.checkThrowStmt(stmt);
      default: return 'any';
    }
  }

  checkLetStmt(stmt) {
    const valueType = this.checkExpr(stmt.expr);
    const declaredType = stmt.typeAnnotation || valueType;
    
    if (stmt.typeAnnotation && !this.isCompatible(valueType, declaredType)) {
      this.error(`Type mismatch: Cannot assign ${valueType} to ${declaredType}`, stmt.loc);
    }
    
    this.setType(stmt.name, declaredType);
    return declaredType;
  }

  checkFnStmt(stmt) {
    const paramTypes = stmt.params.map(p => 
      (typeof p === 'object' && p.typeAnnotation) ? p.typeAnnotation : 'any'
    );
    const returnType = stmt.returnType || 'any';
    
    if (stmt.name) {
      this.functions.set(stmt.name, { params: paramTypes, returns: returnType });
    }
    
    this.pushScope();
    
    for (let i = 0; i < stmt.params.length; i++) {
      const param = stmt.params[i];
      const paramName = typeof param === 'string' ? param : param.name;
      const paramType = (typeof param === 'object' && param.typeAnnotation) ? param.typeAnnotation : 'any';
      this.setType(paramName, paramType);
    }
    
    this.currentReturnType = returnType;
    for (const bodyStmt of stmt.body) this.checkStmt(bodyStmt);
    
    this.popScope();
    this.currentReturnType = null;
    return 'function';
  }

  checkClassStmt(stmt) {
    const classDef = { methods: new Map(), properties: new Map() };
    
    for (const method of stmt.methods) {
      const paramTypes = method.params.map(p => 
        (typeof p === 'object' && p.typeAnnotation) ? p.typeAnnotation : 'any'
      );
      const returnType = method.returnType || 'any';
      classDef.methods.set(method.name, { params: paramTypes, returns: returnType });
      
      this.pushScope();
      this.setType('this', stmt.name);
      
      for (let i = 0; i < method.params.length; i++) {
        const param = method.params[i];
        const paramName = typeof param === 'string' ? param : param.name;
        const paramType = (typeof param === 'object' && param.typeAnnotation) ? param.typeAnnotation : 'any';
        this.setType(paramName, paramType);
      }
      
      this.currentReturnType = returnType;
      for (const bodyStmt of method.body) this.checkStmt(bodyStmt);
      this.popScope();
    }
    
    this.classes.set(stmt.name, classDef);
    this.setType(stmt.name, 'class');
    return 'class';
  }

  checkAssignStmt(stmt) {
    const targetType = this.checkExpr(stmt.target);
    const valueType = this.checkExpr(stmt.expr);
    
    if (targetType !== 'any' && !this.isCompatible(valueType, targetType)) {
      this.error(`Type mismatch: Cannot assign ${valueType} to ${targetType}`, stmt.loc);
    }
    return valueType;
  }

  checkIfStmt(stmt) {
    const condType = this.checkExpr(stmt.cond);
    if (condType !== 'any' && condType !== 'boolean') {
      this.warn(`Condition should be boolean, got ${condType}`, stmt.loc);
    }
    for (const thenStmt of stmt.then) this.checkStmt(thenStmt);
    for (const elseStmt of stmt.otherwise) this.checkStmt(elseStmt);
    return 'null';
  }

  checkWhileStmt(stmt) {
    const condType = this.checkExpr(stmt.cond);
    if (condType !== 'any' && condType !== 'boolean') {
      this.warn(`Condition should be boolean, got ${condType}`, stmt.loc);
    }
    for (const bodyStmt of stmt.body) this.checkStmt(bodyStmt);
    return 'null';
  }

  checkForStmt(stmt) {
    const iterableType = this.checkExpr(stmt.iterable);
    if (!this.isIterable(iterableType)) {
      this.error(`Cannot iterate over ${iterableType}`, stmt.loc);
    }
    this.pushScope();
    const elementType = this.getElementType(iterableType);
    this.setType(stmt.iterator, elementType);
    for (const bodyStmt of stmt.body) this.checkStmt(bodyStmt);
    this.popScope();
    return 'null';
  }

  checkReturnStmt(stmt) {
    if (!stmt.expr) {
      if (this.currentReturnType && this.currentReturnType !== 'null' && this.currentReturnType !== 'any') {
        this.error(`Function should return ${this.currentReturnType}, got null`, stmt.loc);
      }
      return 'null';
    }
    const returnType = this.checkExpr(stmt.expr);
    if (this.currentReturnType && !this.isCompatible(returnType, this.currentReturnType)) {
      this.error(`Return type mismatch: expected ${this.currentReturnType}, got ${returnType}`, stmt.loc);
    }
    return returnType;
  }

  checkTryStmt(stmt) {
    for (const st of stmt.tryBody) this.checkStmt(st);
    for (const st of stmt.catchBody) this.checkStmt(st);
    return 'null';
  }

  checkThrowStmt(stmt) {
    this.checkExpr(stmt.expr);
    return 'null';
  }

  checkExpr(expr) {
    if (!expr) return 'any';
    
    switch (expr.kind) {
      case 'num': return 'number';
      case 'str': return 'string';
      case 'bool': return 'boolean';
      case 'null': return 'null';
      case 'array': return this.checkArrayExpr(expr);
      case 'obj': return 'object';
      case 'var': return this.checkVarExpr(expr);
      case 'bin': return this.checkBinExpr(expr);
      case 'unary': return this.checkUnaryExpr(expr);
      case 'call': return this.checkCallExpr(expr);
      case 'index': return 'any';
      case 'prop': return 'any';
      case 'fn': return 'function';
      default: return 'any';
    }
  }

  checkArrayExpr(expr) {
    if (expr.elements.length === 0) return 'array<any>';
    const elementTypes = expr.elements.map(e => this.checkExpr(e));
    const firstType = elementTypes[0];
    const allSame = elementTypes.every(t => t === firstType);
    return allSame ? `array<${firstType}>` : 'array<any>';
  }

  checkVarExpr(expr) {
    const type = this.getType(expr.name);
    if (!type && this.strict) {
      this.error(`Undefined variable: ${expr.name}`, expr.loc);
    }
    return type || 'any';
  }

  checkBinExpr(expr) {
    const leftType = this.checkExpr(expr.left);
    const rightType = this.checkExpr(expr.right);
    
    if (['+', '-', '*', '/', '%'].includes(expr.op)) {
      if (expr.op === '+' && (leftType === 'string' || rightType === 'string')) return 'string';
      if (leftType !== 'number' && leftType !== 'any') {
        this.warn(`Left operand should be number, got ${leftType}`, expr.loc);
      }
      if (rightType !== 'number' && rightType !== 'any') {
        this.warn(`Right operand should be number, got ${rightType}`, expr.loc);
      }
      return 'number';
    }
    
    if (['==', '!=', '===', '!==', '<', '<=', '>', '>=', '&&', '||'].includes(expr.op)) {
      return 'boolean';
    }
    return 'any';
  }

  checkUnaryExpr(expr) {
    const exprType = this.checkExpr(expr.expr);
    return expr.op === '!' ? 'boolean' : exprType;
  }

  checkCallExpr(expr) {
    if (expr.callee.kind === 'var') {
      const funcSig = this.functions.get(expr.callee.name);
      if (funcSig) {
        if (!funcSig.variadic && expr.args.length !== funcSig.params.length) {
          this.error(`Function ${expr.callee.name} expects ${funcSig.params.length} arguments, got ${expr.args.length}`, expr.loc);
        }
        for (let i = 0; i < Math.min(expr.args.length, funcSig.params.length); i++) {
          const argType = this.checkExpr(expr.args[i]);
          const paramType = funcSig.params[i];
          if (!this.isCompatible(argType, paramType)) {
            this.error(`Argument ${i + 1} type mismatch: expected ${paramType}, got ${argType}`, expr.loc);
          }
        }
        return funcSig.returns;
      }
    }
    return 'any';
  }

  isCompatible(actualType, expectedType) {
    if (expectedType === 'any' || actualType === 'any') return true;
    if (actualType === expectedType) return true;
    if (expectedType.includes('|')) {
      return expectedType.split('|').some(t => this.isCompatible(actualType, t));
    }
    if (expectedType.endsWith('?')) {
      const baseType = expectedType.slice(0, -1);
      return actualType === 'null' || this.isCompatible(actualType, baseType);
    }
    if (expectedType.startsWith('array<') && actualType.startsWith('array<')) {
      const expectedElement = this.getElementType(expectedType);
      const actualElement = this.getElementType(actualType);
      return this.isCompatible(actualElement, expectedElement);
    }
    return false;
  }

  isIterable(type) {
    return type === 'array' || type.startsWith('array<') || type === 'string' || type === 'any';
  }

  getElementType(arrayType) {
    if (arrayType === 'string') return 'string';
    if (arrayType.startsWith('array<')) return arrayType.slice(6, -1);
    return 'any';
  }

  formatReport() {
    let report = '';
    if (this.errors.length > 0) {
      report += `\n❌ Type Errors (${this.errors.length}):\n`;
      for (const err of this.errors) {
        const loc = err.location ? `${err.location.line}:${err.location.col}` : '?';
        report += `  ${loc} - ${err.message}\n`;
      }
    }
    if (this.warnings.length > 0) {
      report += `\n⚠️  Type Warnings (${this.warnings.length}):\n`;
      for (const warn of this.warnings) {
        const loc = warn.location ? `${warn.location.line}:${warn.location.col}` : '?';
        report += `  ${loc} - ${warn.message}\n`;
      }
    }
    if (this.errors.length === 0 && this.warnings.length === 0) {
      report += '\n✅ No type errors found\n';
    }
    return report;
  }
}

/* ================ LEXER ================ */

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

      if (c === '"' || c === "'" || c === "`") {
        const q = this.next();
        let s = "";
        
        while (!this.eof() && this.peek() !== q) {
          let ch = this.next();
          if (ch === "\\") {
            const n = this.next();
            if (n === "n") s += "\n"; 
            else if (n === "t") s += "\t"; 
            else if (n === "r") s += "\r";
            else s += n;
          } else {
            s += ch;
          }
        }
        
        if (this.peek() === q) this.next();
        
        out.push(this.makeToken("string", s, startLine, startCol, startIdx));
        continue;
      }

      if (isAlpha(c)) {
        let id = "";
        while (!this.eof() && /[A-Za-z0-9_]/.test(this.peek())) id += this.next();
        const keywords = [
          "true","false","null","in","for","let","fn","func","function",
          "return","if","else","while","break","continue",
          "import","as","try","catch","throw",
          "class","this","use"
        ];
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

/* ================ PARSER ================ */

class Parser {
  constructor(tokens, src = "") {
    this.tokens = tokens;
    this.i = 0;
    this.src = src || "";
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
    if (this.peek().t === "keyword" && this.peek().v === "use") return this.parseUse();
    if (this.peek().t === "keyword" && this.peek().v === "class") return this.parseClass();
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

  parseUse() {
    this.next();
    if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "use expects builtin name"));
    const name = this.next().v;
    return { kind: "use", name };
  }

  parseClass() {
    this.next();
    if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "class expects a name"));
    const name = this.next().v;
    if (!this.matchSymbol("{")) throw new Error(this.formatTokenError(this.peek(), "class missing {"));
    const methods = [];
    while (!this.matchSymbol("}")) {
      if (!(this.peek().t === "keyword" && (this.peek().v === "fn" || this.peek().v === "func" || this.peek().v === "function"))) {
        throw new Error(this.formatTokenError(this.peek(), "class body expects fn"));
      }
      this.next();
      if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "method expects a name"));
      const mName = this.next().v;
      if (!this.matchSymbol("(")) throw new Error(this.formatTokenError(this.peek(), "method missing ("));
      const params = [];
      if (!this.matchSymbol(")")) {
        while (true) {
          if (this.peek().t !== "id") throw new Error(this.formatTokenError(this.peek(), "method param must be identifier"));
          params.push(this.next().v);
          if (this.matchSymbol(")")) break;
          if (!this.matchSymbol(",")) throw new Error(this.formatTokenError(this.peek(), "expected , or )"));
        }
      }
      if (!this.matchSymbol("{")) throw new Error(this.formatTokenError(this.peek(), "method missing {"));
      const body = [];
      while (!this.matchSymbol("}")) body.push(this.parseStmt());
      methods.push({ name: mName, params, body });
    }
    return { kind: "class", name, methods };
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
    this.next(); // consume 'fn' or 'func'
    
    let name = null;
    if (this.peek().t === "id") {
      name = this.next().v;
    }
    
    if (!this.matchSymbol("(")) {
      throw new Error(this.formatTokenError(this.peek(), "expected ( after fn name or keyword"));
    }
    
    const params = [];
    if (!this.matchSymbol(")")) {
      while (true) {
        if (this.peek().t !== "id") {
          throw new Error(this.formatTokenError(this.peek(), "expected parameter name"));
        }
        params.push(this.next().v);
        if (this.matchSymbol(")")) break;
        if (!this.matchSymbol(",")) {
          throw new Error(this.formatTokenError(this.peek(), "expected , or ) in params"));
        }
      }
    }

    if (!this.matchSymbol("{")) {
        throw new Error(this.formatTokenError(this.peek(), "function missing opening {"));
    }
    
    const body = [];
    while (!this.matchSymbol("}")) {
        body.push(this.parseStmt());
    }
    
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
    let then = [];
    if (this.matchSymbol("{")) {
      while (!this.matchSymbol("}")) then.push(this.parseStmt());
    } else {
      while (this.peek().t === "symbol" && this.peek().v === ";") this.next();
      then.push(this.parseStmt());
    }
    let otherwise = [];
    if (this.peek().t === "keyword" && this.peek().v === "else") {
      this.next();
      while (this.peek().t === "symbol" && this.peek().v === ";") this.next();
      if (this.peek().t === "keyword" && this.peek().v === "if") {
        const elifNode = this.parseIf();
        otherwise.push(elifNode);
      } else if (this.matchSymbol("{")) {
        while (!this.matchSymbol("}")) otherwise.push(this.parseStmt());
      } else {
        otherwise.push(this.parseStmt());
      }
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
    
      if (tk.t === "keyword" && (tk.v === "fn" || tk.v === "func")) {
       return this.parseFn(); 
      }

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

/* ================ BYTECODE OPS ================ */

const Op = {
  CONST: "CONST", LOAD: "LOAD", STORE: "STORE", POP: "POP",
  ADD: "ADD", SUB: "SUB", MUL: "MUL", DIV: "DIV", MOD: "MOD",
  EQ: "EQ", NEQ: "NEQ", LT: "LT", LTE: "LTE", GT: "GT", GTE: "GTE",
  JMP: "JMP", JMPF: "JMPF", CALL: "CALL", RET: "RET", HALT: "HALT",
  AND: "AND", OR: "OR", NOT: "NOT",
  NEWARRAY: "NEWARRAY", NEWOBJ: "NEWOBJ", INDEX: "INDEX", SETINDEX: "SETINDEX",
  GETPROP: "GETPROP", SETPROP: "SETPROP",
  IMPORT: "IMPORT",
  TRY_PUSH: "TRY_PUSH", TRY_POP: "TRY_POP", THROW: "THROW",
  USE: "USE"
};

/* ================ COMPILER ================ */

class Compiler {
  constructor() { 
    this.consts = []; 
    this.code = []; 
    this.sourceMap = []; 
    this.loopStack = []; 
    this.omitHalt = false; 
  }
  
  addConst(v) { const idx = this.consts.indexOf(v); if (idx !== -1) return idx; this.consts.push(v); return this.consts.length - 1; }
  emit(inst, sourceLoc = null) { this.code.push(inst); this.sourceMap.push(sourceLoc); }

  compile(stmts, opts = {}) {
    this.consts = [];
    this.code = [];
    this.sourceMap = [];
    this.omitHalt = !!opts.omitHalt;
    this.sourcePath = opts.sourcePath || '<input>';
    return this.compileProgram(stmts);
  }

  compileProgram(stmts) {
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      const isLast = (i === stmts.length - 1);
      if (isLast && s.kind === "expr") this.emitExpr(s.expr);
      else this.emitStmt(s);
    }
    if (!this.omitHalt) this.emit({ op: Op.HALT });
    return { 
      consts: this.consts, 
      code: this.code, 
      sourceMap: this.sourceMap, 
      sourcePath: this.sourcePath 
    };
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
      case "use": {
        this.emit({ op: Op.USE, arg: this.addConst(s.name) });
        break;
      }
      case "class": {
        this.emit({ op: Op.NEWOBJ, arg: 0 });
        for (const m of s.methods) {
          const sub = new Compiler();
          const bytecode = sub.compile(m.body, { omitHalt: true });
          const fnObj = { params: ["this", ...m.params], code: bytecode.code, consts: bytecode.consts };
          this.emit({ op: Op.CONST, arg: this.addConst(m.name) });
          this.emit({ op: Op.CONST, arg: this.addConst(fnObj) });
          this.emit({ op: Op.SETPROP });
        }
        this.emit({ op: Op.STORE, arg: this.addConst(s.name) });
        break;
      }
      case "fn": {
        const subCompiler = new Compiler();
        const bytecode = subCompiler.compile(s.body, { omitHalt: true });
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
      case "fn": {
        const subCompiler = new Compiler();
        const bytecode = subCompiler.compile(e.body, { omitHalt: true });
        const funcObj = { 
          params: e.params, 
          code: bytecode.code, 
          consts: bytecode.consts 
        };
        this.emit({ op: Op.CONST, arg: this.addConst(funcObj) });
        break;
      }

      default:
        throw new Error("Unsupported expr kind: " + e.kind);
    }
  }
}

/* ================ VM ================ */

class VM {
  constructor(consts = [], code = [], options = {}) {
    this.consts = Array.from(consts);
    this.code = Array.from(code);

    this.frames = [];
    this.stack = [];
    this.globals = new Map();
    this.importCache = new Map();
    this.baseDir = options.baseDir || process.cwd();
    this.debug = !!options.debug;
    
    this.sourceMap = options.sourceMap || [];
    this.sourcePath = options.sourcePath || '<unknown>';

    this._timers = new Map();

    this.ticks = 0;
    this.maxTicks = options.maxTicks || 5_000_000;

    this.builtins = {
      gui: () => createGuiBuiltin(this),
      math: () => createMathBuiltin(this),
      os: () => createOsBuiltin(this),
      http: () => createHttpBuiltin(this),
    };

    this.onGuiRender = null;

    this.setupBuiltins();
  }

  setupBuiltins() {
    const self = this;

    this.globals.set("print", { builtin: true, call: (args) => { console.log(...args.map(a => (a === null ? "null" : a))); return null; } });
    this.globals.set("len", { builtin: true, call: (args) => {
      const v = args[0];
      if (v === null || v === undefined) return 0;
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
    this.globals.set("push", { builtin: true, call: (args) => { const a = args[0]; if (!Array.isArray(a)) throw new Error("push expects an array as first argument"); a.push(args[1]); return a.length; }});
    this.globals.set("pop", { builtin: true, call: (args) => { const a = args[0]; if (!Array.isArray(a)) throw new Error("pop expects an array as first argument"); return a.length ? a.pop() : null; }});
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
      const full = path.resolve(this.baseDir, p);
      if (!fs.existsSync(full)) throw new Error("read: file not found: " + full);
      return fs.readFileSync(full, "utf8");
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
      const url = String(args[0]);
      const opts = args[1] || {};
      if (fetchImpl) {
        return fetchImpl(url, opts).then(async res => {
          const headersObj = {};
          try {
            if (res.headers && typeof res.headers.forEach === "function") {
              res.headers.forEach((v, k) => { headersObj[k] = v; });
            } else if (res.headers && typeof res.headers === "object") {
              for (const k of Object.keys(res.headers)) headersObj[k] = res.headers[k];
            }
          } catch (e) {}
          const text = await (res.text ? res.text() : Promise.resolve(String(res)));
          let parsed = null;
          try { parsed = JSON.parse(text); } catch (e) {}
          return { status: res.status || 200, headers: headersObj, text, json: parsed };
        });
      }
      return new Promise((resolve, reject) => {
        try {
          const u = require('url').parse(url);
          const lib = u.protocol === 'https:' ? require('https') : require('http');
          const method = (opts.method || 'GET').toUpperCase();
          const body = opts.body || null;
          const headers = opts.headers || {};
          const req = lib.request({
            hostname: u.hostname,
            path: u.path || '/',
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            method,
            headers
          }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
              const txt = Buffer.concat(chunks).toString('utf8');
              let j = null;
              try { j = JSON.parse(txt); } catch (e) {}
              const hObj = {};
              try { Object.keys(res.headers).forEach(k => hObj[k] = res.headers[k]); } catch (e) {}
              resolve({ status: res.statusCode, headers: hObj, text: txt, json: j });
            });
          });
          req.on('error', e => reject(e));
          if (body) {
            if (typeof body === "string" || Buffer.isBuffer(body)) req.write(body);
            else req.write(JSON.stringify(body));
          }
          req.end();
        } catch (e) {
          reject(e);
        }
      });
    }});

    this.globals.set("sleep", { builtin: true, call: (args) => {
      const ms = Number(args[0] || 0);
      return new Promise(resolve => setTimeout(resolve, ms));
    }});

    this.globals.set("setTimeout", { builtin: true, call: (args) => {
      const fn = args[0];
      const ms = Number(args[1] || 0);
      const id = Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9);
      const timer = setTimeout(async () => {
        try {
          if (fn && fn.code && Array.isArray(fn.code)) {
            const funcFrame = {
              code: fn.code,
              consts: fn.consts,
              ip: 0,
              locals: new Map(),
              baseDir: this.baseDir,
              isGlobal: false,
              tryStack: [],
              module: fn.__module || null
            };
            this.frames.push(funcFrame);
            await this.run();
          } else if (typeof fn === "function") {
            const res = fn();
            if (res && typeof res.then === "function") await res;
          }
        } catch (e) {
          console.error("setTimeout callback error:", e);
        } finally {
          this._timers.delete(id);
        }
      }, ms);
      this._timers.set(id, { timer, type: "timeout" });
      return id;
    }});

    this.globals.set("setInterval", { builtin: true, call: (args) => {
      const fn = args[0];
      const ms = Number(args[1] || 0);
      const id = Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9);
      const timer = setInterval(async () => {
        try {
          if (fn && fn.code && Array.isArray(fn.code)) {
            const funcFrame = {
              code: fn.code,
              consts: fn.consts,
              ip: 0,
              locals: new Map(),
              baseDir: this.baseDir,
              isGlobal: false,
              tryStack: [],
              module: fn.__module || null
            };
            this.frames.push(funcFrame);
            await this.run();
          } else if (typeof fn === "function") {
            const res = fn();
            if (res && typeof res.then === "function") await res;
          }
        } catch (e) {
          console.error("setInterval callback error:", e);
        }
      }, ms);
      this._timers.set(id, { timer, type: "interval" });
      return id;
    }});

    this.globals.set("clearTimeout", { builtin: true, call: (args) => {
      const id = args[0];
      if (!id) return null;
      const rec = this._timers.get(String(id));
      if (!rec) return null;
      if (rec.type === "timeout") clearTimeout(rec.timer);
      else if (rec.type === "interval") clearInterval(rec.timer);
      this._timers.delete(String(id));
      return null;
    }});
    this.globals.set("clearInterval", this.globals.get("clearTimeout"));

    this.globals.set("assert", { builtin: true, call: (args) => {
      const cond = args[0];
      if (!cond) throw new Error(args.length > 1 ? String(args[1]) : "assertion failed");
      return null;
    }});

    this.globals.set("typeOf", { builtin: true, call: (args) => {
      const v = args[0];
      if (v === null) return "null";
      if (Array.isArray(v)) return "array";
      return typeof v;
    }});

    this.globals.set("inspect", { builtin: true, call: (args) => {
      try { return JSON.stringify(args[0], null, 2); } catch (e) { return String(args[0]); }
    }});
  }

  push(v) { this.stack.push(v); }
  pop() { return this.stack.pop(); }

  tryNumber(x) {
    if (typeof x === "string") {
      const s = x.trim();
      if (s !== "" && !isNaN(Number(s))) return Number(s);
    }
    return x;
  }

  resolveName(frame, name) {
    if (frame && frame.locals && frame.locals.has(name)) return frame.locals.get(name);
    if (frame && frame.module && Object.prototype.hasOwnProperty.call(frame.module, name)) return frame.module[name];
    if (this.globals.has(name)) return this.globals.get(name);
    return undefined;
  }

  setName(frame, name, value) {
    if (frame && frame.locals && frame.locals.has(name)) {
      frame.locals.set(name, value);
      return;
    }
    if (frame && frame.module) {
      frame.module[name] = value;
      return;
    }
    this.globals.set(name, value);
  }

  async callFunction(fn, args = []) {
    if (!fn || !fn.code || !Array.isArray(fn.code)) {
      if (typeof fn === "function") {
        const res = fn(...args);
        if (res && typeof res.then === "function") return await res;
        return res;
      }
      return null;
    }

    const frame = {
      code: fn.code,
      consts: fn.consts,
      ip: 0,
      locals: new Map(),
      baseDir: this.baseDir,
      isGlobal: false,
      tryStack: [],
      module: fn.__module || null
    };

    for (let i = 0; i < (fn.params ? fn.params.length : 0); i++) {
      frame.locals.set(fn.params[i], args[i]);
    }

    this.frames.push(frame);
    try {
      await this.run();
    } catch (e) {
      console.error("Error in callFunction:", e);
    }
    return null;
  }

  __sendUI(ui, widgetMap) {
    const serial = {};
    for (const [id, w] of widgetMap.entries()) {
      const copy = {};
      copy.type = w.type;
      if (w.text !== undefined) copy.text = w.text;
      if (w.value !== undefined) copy.value = w.value;
      if (w.children !== undefined) copy.children = Array.isArray(w.children) ? w.children.slice() : [];
      if (w.width !== undefined) copy.width = w.width;
      if (w.height !== undefined) copy.height = w.height;
      if (w.ops !== undefined) copy.ops = w.ops.slice();
      if (w.path !== undefined) copy.path = w.path;
      if (w.style !== undefined) copy.style = Object.assign({}, w.style);
      copy._id = id;
      serial[id] = copy;
    }
    const payload = { ui, widgets: serial };
    if (this.onGuiRender) this.onGuiRender(payload);
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
      module: null,
      sourceMap: this.sourceMap,
      sourcePath: this.sourcePath
    };

    if (this.frames.length === 0) this.frames.push(globalFrame);

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
        if (++this.ticks > this.maxTicks) {
          throw new Error("VM halted: instruction limit exceeded (possible infinite loop)");
        }

        switch (inst.op) {
          case Op.CONST: {
            const v = frame.consts[inst.arg];
            this.push(v);
            break;
          }
          case Op.LOAD: {
            const name = frame.consts[inst.arg];
            const val = this.resolveName(frame, name);
            if (this.debug && val === undefined) console.warn(`⚠️ LOAD undefined: ${name} (ip ${frame.ip - 1})`);
            this.push(val);
            break;
          }
          case Op.STORE: {
            const name = frame.consts[inst.arg];
            const val = this.pop();
            if (frame.locals && frame.locals.has(name)) {
              frame.locals.set(name, val);
            } else if (frame.module) {
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
            const an = this.tryNumber(a); const bn = this.tryNumber(b);
            if (typeof an === "number" && typeof bn === "number") {
              this.push(an + bn);
            } else {
              this.push(a + b);
            }
            break;
          }
          case Op.SUB: {
            const b = this.pop(); const a = this.pop();
            this.push(Number(a) - Number(b));
            break;
          }
          case Op.MUL: {
            const b = this.pop(); const a = this.pop();
            this.push(Number(a) * Number(b));
            break;
          }
          case Op.DIV: {
            const b = this.pop(); const a = this.pop();
            this.push(Number(a) / Number(b));
            break;
          }
          case Op.MOD: {
            const b = this.pop(); const a = this.pop();
            this.push(Number(a) % Number(b));
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
            let full;
            if (path.isAbsolute(fileConst)) full = fileConst;
            else full = path.resolve(frame.baseDir || this.baseDir, fileConst);
            
            if (this.importCache.has(full)) {
              this.push(this.importCache.get(full));
              break;
            }
            
            let foundPath = null;
            if (fs.existsSync(full)) {
              foundPath = full;
            } else if (fs.existsSync(full + ".vx")) {
              foundPath = full + ".vx";
            } else if (fs.existsSync(full + ".js")) {
              foundPath = full + ".js";
            } else {
              throw new Error(`Import file not found: ${full}`);
            }
            
            const src = fs.readFileSync(foundPath, "utf8");
            
            if (foundPath.endsWith('.js')) {
              try {
                delete require.cache[require.resolve(foundPath)];
                const moduleObj = require(foundPath);
                this.importCache.set(full, moduleObj);
                this.push(moduleObj);
              } catch (e) {
                throw new Error(`Failed to import JavaScript module: ${e.message}`);
              }
              break;
            }
            
            const lexer = new Lexer(src);
            const tokens = lexer.lex();
            const parser = new Parser(tokens, src);
            const stmts = parser.parseProgram();
            const compiler = new Compiler();
            const compiled = compiler.compile(stmts);

            const childVM = new VM(compiled.consts, compiled.code, { 
              baseDir: path.dirname(foundPath), 
              debug: this.debug 
            });
            
            for (const [k, v] of this.globals.entries()) {
              if (v && v.builtin) childVM.globals.set(k, v);
            }
            
            await childVM.run();

            const moduleObj = {};
            for (const [k, v] of childVM.globals.entries()) {
              if (v && v.builtin) continue;
              moduleObj[k] = v;
            }

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
            if (this.debug) console.log("CALL target =", callee);

            if (callee === undefined || callee === null) throw new Error("Call of undefined or null");

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

            if (callee && typeof callee === "object" && callee.init && callee.init.code) {
              const obj = {};
              const initFn = callee.init;
              const funcFrame = {
                code: initFn.code,
                consts: initFn.consts,
                ip: 0,
                locals: new Map(),
                baseDir: frame.baseDir,
                isGlobal: false,
                tryStack: [],
                module: initFn.__module || null
              };
              funcFrame.locals.set("this", obj);
              for (let i = 0; i < (initFn.params ? initFn.params.length - 1 : 0); i++) {
                funcFrame.locals.set(initFn.params[i+1], args[i]);
              }
              this.frames.push(funcFrame);
              this.push(obj);
              break;
            }

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
              for (let i = 0; i < (callee.params ? callee.params.length : 0); i++) {
                funcFrame.locals.set(callee.params[i], args[i]);
              }
              this.frames.push(funcFrame);
              break;
            }

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

            throw new Error("Unsupported call target: " + String(callee));
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
            if (frame.isGlobal) {
              return null;
            } else {
              this.frames.pop();
              if (this.frames.length > 0) {
                this.push(undefined);
                break;
              } else {
                return null;
              }
            }
          }
          case Op.NOT: {
            const v = this.pop();
            this.push(!v);
            break;
          }
          case Op.TRY_PUSH: {
            const catchIp = inst.arg;
            const stackHeight = this.stack.length;
            if (!frame.tryStack) frame.tryStack = [];
            frame.tryStack.push({ catchIp, stackHeight });
            break;
          }
          case Op.TRY_POP: {
            if (frame.tryStack && frame.tryStack.length > 0) {
              frame.tryStack.pop();
            }
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
          case Op.USE: {
            const name = frame.consts[inst.arg];
            if (!this.builtins[name]) throw new Error("Unknown builtin: " + name);
            if (!this.globals.has(name)) {
              const mod = this.builtins[name]();
              this.globals.set(name, mod);
              if (mod && typeof mod === "object") {
                for (const k of Object.keys(mod)) {
                  try {
                    if (!this.globals.has(k)) this.globals.set(k, mod[k]);
                  } catch (e) {
                    try { this.globals.set(k, mod[k]); } catch (err) {}
                  }
                }
              }
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
          console.error("❌ Vexon Runtime Error:", exObj.message);
          if (err.stack && this.debug) console.error(err.stack);
          throw err;
        }
      }
    }
    return null;
  }
}

/* ================ GUI BUILTIN ================ */

function createGuiBuiltin(vm) {
  let widgetId = 1;
  const widgets = new Map();
  const handlersMap = new Map();
  const STYLE_WHITELIST = new Set(["padding","margin","background","color","fontSize","width","height","display","flexDirection"]);

  function mergeStyle(state, styleObj) {
    state.style = state.style || {};
    for (const k of Object.keys(styleObj)) {
      if (STYLE_WHITELIST.has(k)) {
        state.style[k] = styleObj[k];
      } else {
        state.style[k] = styleObj[k];
      }
    }
  }

  function Window(title, w, h) {
    const id = widgetId++;
    const state = { type: "window", title: title || "", width: w || 400, height: h || 300, children: [], style: {} };
    widgets.set(id, state);
    handlersMap.set(id, {});

    vm.__dispatchEvent = vm.__dispatchEvent || function() { if (vm.debug) console.log("dispatchEvent placeholder"); };
    vm.__dispatchGlobalKey = vm.__dispatchGlobalKey || function() { if (vm.debug) console.log("dispatchKey placeholder"); };

    return {
      _id: id,
      _type: "window",
      add(widget) {
        if (widget && widget._id) state.children.push(widget._id);
      },
      on(event, fn) {
        handlersMap.get(id)[event] = fn;
      },
      setTitle(t) { state.title = t; },
      setSize(wi, he) { state.width = wi; state.height = he; },
      show() {
        const ui = { type: "window", id, children: state.children.slice() };
        vm.__sendUI(ui, widgets);
      },
      close() {
        const h = handlersMap.get(id)["close"];
        if (h) vm.callFunction(h, []);
      },
      setStyle(obj) { mergeStyle(state, obj); vm.__sendUI({ type: "noop" }, widgets); }
    };
  }

  function Button(text) {
    const id = widgetId++;
    const state = { type: "button", text: text ?? "", style: {} };
    widgets.set(id, state);
    handlersMap.set(id, {});
    return {
      _id: id,
      _type: "button",
      setText(t) { state.text = t; vm.__sendUI({ type: "noop" }, widgets); },
      setEnabled(v) { state.enabled = !!v; vm.__sendUI({ type: "noop" }, widgets); },
      on(event, fn) { handlersMap.get(id)[event] = fn; },
      _emit(event, ...args) {
        const h = handlersMap.get(id)[event];
        if (h) vm.callFunction(h, args);
      },
      setStyle(obj) { mergeStyle(state, obj); vm.__sendUI({ type: "noop" }, widgets); }
    };
  }

  function Label(text) {
    const id = widgetId++;
    const state = { type: "label", text: text ?? "", style: {} };
    widgets.set(id, state);
    handlersMap.set(id, {});
    return {
      _id: id,
      _type: "label",
      setText(t) { state.text = t; vm.__sendUI({ type: "noop" }, widgets); },
      setStyle(obj) { mergeStyle(state, obj); vm.__sendUI({ type: "noop" }, widgets); }
    };
  }

  function TextBox() {
    const id = widgetId++;
    let value = "";
    const state = { type: "textbox", value: "", style: {} };
    widgets.set(id, state);
    const handlers = {};
    handlersMap.set(id, handlers);
    return {
      _id: id,
      _type: "textbox",
      getText() { return value; },
      setText(t) { value = t; state.value = t; vm.__sendUI({ type: "noop" }, widgets); },
      on(event, fn) { handlers[event] = fn; },
      _emit(event, arg) {
        if (event === "change") {
          value = arg;
          state.value = arg;
        }
        const h = handlers[event];
        if (h) vm.callFunction(h, [arg]);
      },
      setStyle(obj) { mergeStyle(state, obj); vm.__sendUI({ type: "noop" }, widgets); }
    };
  }

  function VBox() {
    const id = widgetId++;
    const children = [];
    const state = { type: "vbox", children, style: {} };
    widgets.set(id, state);
    handlersMap.set(id, {});
    return {
      _id: id,
      _type: "vbox",
      add(w) { if (w && w._id) children.push(w._id); vm.__sendUI({ type: "noop" }, widgets); },
      setStyle(obj) { mergeStyle(state, obj); vm.__sendUI({ type: "noop" }, widgets); }
    };
  }

  function HBox() {
    const id = widgetId++;
    const children = [];
    const state = { type: "hbox", children, style: {} };
    widgets.set(id, state);
    handlersMap.set(id, {});
    return {
      _id: id,
      _type: "hbox",
      add(w) { if (w && w._id) children.push(w._id); vm.__sendUI({ type: "noop" }, widgets); },
      setStyle(obj) { mergeStyle(state, obj); vm.__sendUI({ type: "noop" }, widgets); }
    };
  }

  function Canvas(w, h) {
    const id = widgetId++;
    const state = { type: "canvas", width: w || 300, height: h || 150, ops: [], dirty: true, style: {} };
    widgets.set(id, state);
    const handlers = {};
    handlersMap.set(id, handlers);
    return {
      _id: id,
      _type: "canvas",
      clear() { const s = widgets.get(id); s.ops = []; s.dirty = true; vm.__sendUI({ type: "noop" }, widgets); },
      clearRect(x, y, wi, he) { const s = widgets.get(id); s.ops.push(["clearRect", x, y, wi, he]); s.dirty = true; vm.__sendUI({ type: "noop" }, widgets); },
      drawRect(x, y, wi, he, color) { const s = widgets.get(id); s.ops.push(["rect", x, y, wi, he, color]); s.dirty = true; vm.__sendUI({ type: "noop" }, widgets); },
      drawCircle(x, y, r, color) { const s = widgets.get(id); s.ops.push(["circle", x, y, r, color]); s.dirty = true; vm.__sendUI({ type: "noop" }, widgets); },
      drawText(x, y, text, color) { const s = widgets.get(id); s.ops.push(["text", x, y, text, color]); s.dirty = true; vm.__sendUI({ type: "noop" }, widgets); },
      drawImage(imgObj, x, y, wi, he) {
        const s = widgets.get(id);
        if (!imgObj || !imgObj._id) return;
        s.ops.push(["image", imgObj._id, x, y, wi === undefined ? null : wi, he === undefined ? null : he]);
        s.dirty = true;
        vm.__sendUI({ type: "noop" }, widgets);
      },
      drawLine(x1, y1, x2, y2, color, width) {
        const s = widgets.get(id);
        s.ops.push(["line", x1, y1, x2, y2, color === undefined ? "black" : color, width === undefined ? 1 : width]);
        s.dirty = true;
        vm.__sendUI({ type: "noop" }, widgets);
      },
      drawTriangle(x1, y1, x2, y2, x3, y3, color) {
        const s = widgets.get(id);
        s.ops.push(["triangle", x1, y1, x2, y2, x3, y3, color === undefined ? "black" : color]);
        s.dirty = true;
        vm.__sendUI({ type: "noop" }, widgets);
      },
      drawArc(x, y, r, start, end, color) {
        const s = widgets.get(id);
        s.ops.push(["arc", x, y, r, start, end, color === undefined ? "black" : color]);
        s.dirty = true;
        vm.__sendUI({ type: "noop" }, widgets);
      },
      on(event, fn) { handlers[event] = fn; },
      _emit(event, ...args) { const h = handlers[event]; if (h) vm.callFunction(h, args); },
      setStyle(obj) { mergeStyle(state, obj); vm.__sendUI({ type: "noop" }, widgets); }
    };
  }

  function ImageObj(p) {
    const id = widgetId++;
    const state = { type: "image", path: p };
    widgets.set(id, state);
    handlersMap.set(id, {});
    return { _id: id, _type: "image" };
  }

  vm.__dispatchEvent = function(id, ev, ...args) {
    const hmap = handlersMap.get(id);
    if (!hmap) return;
    const h = hmap[ev];
    if (h) vm.callFunction(h, args);
  };

  vm.__dispatchGlobalKey = function(type, key) {
    for (const [id, hmap] of handlersMap.entries()) {
      if (hmap[type]) vm.callFunction(hmap[type], [key]);
    }
  };

  return {
    Window,
    Button,
    Label,
    TextBox,
    VBox,
    HBox,
    Canvas,
    Image: ImageObj
  };
}

/* ================ MATH BUILTIN ================ */

function createMathBuiltin(vm) {
  return {
    sin: { builtin: true, call: (args) => Math.sin(Number(args[0] || 0)) },
    cos: { builtin: true, call: (args) => Math.cos(Number(args[0] || 0)) },
    tan: { builtin: true, call: (args) => Math.tan(Number(args[0] || 0)) },
    sqrt: { builtin: true, call: (args) => Math.sqrt(Number(args[0] || 0)) },
    pow: { builtin: true, call: (args) => Math.pow(Number(args[0] || 0), Number(args[1] || 0)) },
    floor: { builtin: true, call: (args) => Math.floor(Number(args[0] || 0)) },
    ceil: { builtin: true, call: (args) => Math.ceil(Number(args[0] || 0)) },
    abs: { builtin: true, call: (args) => Math.abs(Number(args[0] || 0)) },
    random: { builtin: true, call: () => Math.random() },
    PI: 3.14159265359
  };
}

/* ================ OS BUILTIN ================ */

function createOsBuiltin(vm) {
  const os = require('os');
  return {
    platform: { builtin: true, call: () => process.platform },
    homedir: { builtin: true, call: () => os.homedir() },
    tmpdir: { builtin: true, call: () => os.tmpdir() },
    exit: { builtin: true, call: (args) => process.exit(Number(args[0] || 0)) },
    env: { builtin: true, call: () => process.env },
    cwd: { builtin: true, call: () => process.cwd() },
    chdir: { builtin: true, call: (args) => { process.chdir(String(args[0] || '.')); return null; } }
  };
}

/* ================ HTTP BUILTIN ================ */

function createHttpBuiltin(vm) {
  class VexonHttpServer {
    constructor(options = {}) {
      this.routes = new Map();
      this.middleware = [];
      this.staticDirs = [];
      this.server = null;
      this.port = options.port || 3000;
      this.host = options.host || 'localhost';
    }

    use(handler) { this.middleware.push(handler); }

    route(method, path, handler) {
      const key = `${method.toUpperCase()}:${path}`;
      this.routes.set(key, handler);
    }

    get(path, handler) { this.route('GET', path, handler); }
    post(path, handler) { this.route('POST', path, handler); }
    put(path, handler) { this.route('PUT', path, handler); }
    delete(path, handler) { this.route('DELETE', path, handler); }
    patch(path, handler) { this.route('PATCH', path, handler); }

    static(dirPath) {
      this.staticDirs.push(path.resolve(dirPath));
    }

    async handleRequest(req, res) {
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;
      const query = parsedUrl.query;

      const request = {
        method: req.method,
        url: req.url,
        path: pathname,
        query: query,
        headers: req.headers,
        body: null,
        params: {}
      };

      const response = {
        statusCode: 200,
        headers: {},
        body: null,
        
        status(code) { this.statusCode = code; return this; },
        header(name, value) { this.headers[name] = value; return this; },
        json(data) { this.header('Content-Type', 'application/json'); this.body = JSON.stringify(data); return this; },
        text(data) { this.header('Content-Type', 'text/plain'); this.body = String(data); return this; },
        html(data) { this.header('Content-Type', 'text/html'); this.body = String(data); return this; },
        send(data) { return typeof data === 'object' ? this.json(data) : this.text(data); },
        redirect(url) { this.status(302).header('Location', url); return this; },
        
        sendFile(filePath) {
          try {
            const fullPath = path.resolve(filePath);
            const content = fs.readFileSync(fullPath);
            const ext = path.extname(fullPath);
            const mimeTypes = {
              '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
              '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
              '.ico': 'image/x-icon', '.txt': 'text/plain', '.pdf': 'application/pdf'
            };
            this.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            this.body = content;
            return this;
          } catch (e) {
            this.status(404).text('File not found');
            return this;
          }
        }
      };

      try {
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          request.body = await this.parseBody(req);
        }

        for (const mw of this.middleware) {
          const continueProcessing = await vm.callFunction(mw, [request, response]);
          if (continueProcessing === false) {
            return this.sendResponse(res, response);
          }
        }

        for (const staticDir of this.staticDirs) {
          const filePath = path.join(staticDir, pathname);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            response.sendFile(filePath);
            return this.sendResponse(res, response);
          }
        }

        let handler = null;
        let routeKey = `${req.method}:${pathname}`;
        
        if (this.routes.has(routeKey)) {
          handler = this.routes.get(routeKey);
        } else {
          for (const [key, h] of this.routes.entries()) {
            const [method, pattern] = key.split(':');
            if (method === req.method) {
              const params = this.matchRoute(pattern, pathname);
              if (params) {
                request.params = params;
                handler = h;
                break;
              }
            }
          }
        }

        if (handler) {
          await vm.callFunction(handler, [request, response]);
        } else {
          response.status(404).text('Not Found');
        }

        this.sendResponse(res, response);
      } catch (err) {
        console.error('Request handling error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }

    matchRoute(pattern, pathname) {
      const patternParts = pattern.split('/').filter(p => p);
      const pathParts = pathname.split('/').filter(p => p);
      
      if (patternParts.length !== pathParts.length) return null;
      
      const params = {};
      for (let i = 0; i < patternParts.length; i++) {
        const patternPart = patternParts[i];
        const pathPart = pathParts[i];
        if (patternPart.startsWith(':')) {
          params[patternPart.slice(1)] = pathPart;
        } else if (patternPart !== pathPart) {
          return null;
        }
      }
      return params;
    }

    parseBody(req) {
      return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          const contentType = req.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            try { resolve(JSON.parse(body)); }
            catch (e) { resolve(body); }
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            resolve(querystring.parse(body));
          } else {
            resolve(body);
          }
        });
        req.on('error', reject);
      });
    }

    sendResponse(res, response) {
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body || '');
    }

    listen(callback) {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      
      this.server.listen(this.port, this.host, () => {
        console.log(`🚀 Server running at http://${this.host}:${this.port}/`);
        if (callback) vm.callFunction(callback, []);
      });
      
      return this;
    }

    close() {
      if (this.server) this.server.close();
    }
  }

  async function makeRequest(method, url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;
      
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: method.toUpperCase(),
        headers: options.headers || {}
      };
      
      const req = lib.request(reqOptions, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          let parsed = null;
          const contentType = res.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            try { parsed = JSON.parse(body); } catch (e) {}
          }
          resolve({ status: res.statusCode, headers: res.headers, body: body, json: parsed });
        });
      });
      
      req.on('error', reject);
      
      if (options.body) {
        const body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        req.write(body);
      }
      
      req.end();
    });
  }

  return {
    Server: { builtin: true, call: (args) => new VexonHttpServer(args[0] || {}) },
    get: { builtin: true, call: (args) => makeRequest('GET', args[0], args[1]) },
    post: { builtin: true, call: (args) => makeRequest('POST', args[0], args[1]) },
    put: { builtin: true, call: (args) => makeRequest('PUT', args[0], args[1]) },
    delete: { builtin: true, call: (args) => makeRequest('DELETE', args[0], args[1]) },
    patch: { builtin: true, call: (args) => makeRequest('PATCH', args[0], args[1]) },
    request: { builtin: true, call: (args) => makeRequest(args[0], args[1], args[2]) },
    urlParse: { builtin: true, call: (args) => {
      const parsed = url.parse(args[0], true);
      return {
        protocol: parsed.protocol, host: parsed.host, hostname: parsed.hostname,
        port: parsed.port, pathname: parsed.pathname, search: parsed.search,
        query: parsed.query, hash: parsed.hash
      };
    }},
    urlFormat: { builtin: true, call: (args) => url.format(args[0]) },
    queryParse: { builtin: true, call: (args) => querystring.parse(args[0]) },
    queryStringify: { builtin: true, call: (args) => querystring.stringify(args[0]) }
  };
}

/* ================ EXPORTS ================ */

module.exports = { Lexer, Parser, Compiler, VM, Op, TypeChecker };
