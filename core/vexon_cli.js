#!/usr/bin/env node
// vexon_cli.js – Complete with debugger and type checker built-in
// Vexon 0.4.1 - All features consolidated
"use strict";

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const readline = require("readline");
const { Lexer, Parser, Compiler, VM, TypeChecker } = require("./vexon_core.js");

const ELECTRON_FLAG = "--vexon-electron";

/* ================ DEBUGGER ================ */

class VexonDebugger {
  constructor(vm, sourcePath) {
    this.vm = vm;
    this.sourcePath = sourcePath;
    this.breakpoints = new Map();
    this.stepMode = null;
    this.stepDepth = 0;
    this.paused = false;
    this.sourceCache = new Map();
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  hasBreakpoint(file, line) {
    const key = `${file}:${line}`;
    return this.breakpoints.has(key);
  }

  setBreakpoint(file, line) {
    const key = `${file}:${line}`;
    this.breakpoints.set(key, true);
    console.log(`✓ Breakpoint set at ${file}:${line}`);
  }

  removeBreakpoint(file, line) {
    const key = `${file}:${line}`;
    if (this.breakpoints.delete(key)) {
      console.log(`✓ Breakpoint removed at ${file}:${line}`);
    } else {
      console.log(`⚠️  No breakpoint at ${file}:${line}`);
    }
  }

  listBreakpoints() {
    if (this.breakpoints.size === 0) {
      console.log('No breakpoints set');
      return;
    }
    console.log('Breakpoints:');
    for (const bp of this.breakpoints.keys()) {
      console.log(`  ${bp}`);
    }
  }

  showSourceContext(file, line, context = 3) {
    let source = this.sourceCache.get(file);
    
    if (!source) {
      try {
        source = fs.readFileSync(file, 'utf-8');
        this.sourceCache.set(file, source);
      } catch (e) {
        console.log(`Cannot read source: ${file}`);
        return;
      }
    }
    
    const lines = source.split('\n');
    const start = Math.max(0, line - context - 1);
    const end = Math.min(lines.length, line + context);
    
    console.log(`\n${file}:`);
    for (let i = start; i < end; i++) {
      const lineNum = String(i + 1).padStart(4, ' ');
      const marker = (i + 1 === line) ? '>' : ' ';
      const bp = this.hasBreakpoint(file, i + 1) ? '●' : ' ';
      console.log(`${bp} ${marker} ${lineNum} | ${lines[i]}`);
    }
    console.log();
  }

  async pause(frame, ip) {
    this.paused = true;
    this.stepMode = null;
    
    const loc = frame.sourceMap && frame.sourceMap[ip];
    if (loc) {
      this.showSourceContext(frame.sourcePath || this.sourcePath, loc.line);
    }
    
    await this.debugPrompt();
  }

  async debugPrompt() {
    return new Promise((resolve) => {
      this.rl.question('(vdb) ', async (input) => {
        await this.handleCommand(input.trim());
        if (!this.paused) {
          resolve();
        } else {
          resolve(await this.debugPrompt());
        }
      });
    });
  }

  async handleCommand(cmd) {
    const [command, ...args] = cmd.split(/\s+/);
    
    switch (command) {
      case 'c':
      case 'continue':
        this.paused = false;
        console.log('Continuing...');
        break;
        
      case 's':
      case 'step':
        this.stepMode = 'into';
        this.stepDepth = this.vm.frames.length;
        this.paused = false;
        break;
        
      case 'n':
      case 'next':
        this.stepMode = 'over';
        this.stepDepth = this.vm.frames.length;
        this.paused = false;
        break;
        
      case 'o':
      case 'out':
        this.stepMode = 'out';
        this.stepDepth = this.vm.frames.length;
        this.paused = false;
        break;
        
      case 'b':
      case 'break':
        if (args.length < 2) {
          console.log('Usage: break <file> <line>');
          break;
        }
        this.setBreakpoint(args[0], parseInt(args[1]));
        break;
        
      case 'clear':
        if (args.length < 2) {
          console.log('Usage: clear <file> <line>');
          break;
        }
        this.removeBreakpoint(args[0], parseInt(args[1]));
        break;
        
      case 'l':
      case 'list':
        this.listBreakpoints();
        break;
        
      case 'p':
      case 'print':
        if (args.length === 0) {
          console.log('Usage: print <variable>');
          break;
        }
        this.printVariable(args[0]);
        break;
        
      case 'locals':
        this.showLocals();
        break;
        
      case 'globals':
        this.showGlobals();
        break;
        
      case 'stack':
      case 'bt':
        this.showStackTrace();
        break;
        
      case 'h':
      case 'help':
        this.showHelp();
        break;
        
      case 'q':
      case 'quit':
        console.log('Exiting debugger...');
        process.exit(0);
        break;
        
      default:
        if (cmd) {
          console.log(`Unknown command: ${command}`);
          console.log('Type "help" for available commands');
        }
    }
  }

  printVariable(name) {
    const frame = this.vm.frames[this.vm.frames.length - 1];
    let value;
    
    if (frame.locals && frame.locals.has(name)) {
      value = frame.locals.get(name);
    } else if (this.vm.globals.has(name)) {
      value = this.vm.globals.get(name);
    } else {
      console.log(`Variable not found: ${name}`);
      return;
    }
    
    console.log(`${name} = ${this.formatValue(value)}`);
  }

  showLocals() {
    const frame = this.vm.frames[this.vm.frames.length - 1];
    
    if (!frame || !frame.locals || frame.locals.size === 0) {
      console.log('No local variables');
      return;
    }
    
    console.log('Local variables:');
    for (const [name, value] of frame.locals.entries()) {
      console.log(`  ${name} = ${this.formatValue(value)}`);
    }
  }

  showGlobals() {
    console.log('Global variables:');
    for (const [name, value] of this.vm.globals.entries()) {
      if (value && value.builtin) continue;
      console.log(`  ${name} = ${this.formatValue(value)}`);
    }
  }

  showStackTrace() {
    console.log('Call stack:');
    for (let i = this.vm.frames.length - 1; i >= 0; i--) {
      const frame = this.vm.frames[i];
      const loc = frame.sourceMap && frame.sourceMap[frame.ip - 1];
      const locStr = loc ? `:${loc.line}:${loc.col}` : '';
      console.log(`  #${this.vm.frames.length - i - 1}: ${frame.sourcePath || '<unknown>'}${locStr}`);
    }
  }

  formatValue(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return `"${val}"`;
    if (Array.isArray(val)) {
      if (val.length > 10) {
        return `[${val.slice(0, 10).map(v => this.formatValue(v)).join(', ')}, ... (${val.length} items)]`;
      }
      return '[' + val.map(v => this.formatValue(v)).join(', ') + ']';
    }
    if (typeof val === 'object') {
      try {
        const str = JSON.stringify(val, null, 2);
        if (str.length > 100) return str.substring(0, 100) + '...';
        return str;
      } catch (e) {
        return String(val);
      }
    }
    return String(val);
  }

  showHelp() {
    console.log(`
Vexon Debugger Commands:
  c, continue       - Continue execution
  s, step          - Step into (execute next line, enter functions)
  n, next          - Step over (execute next line, skip functions)
  o, out           - Step out (finish current function)
  
  b, break <file> <line>  - Set breakpoint
  clear <file> <line>     - Remove breakpoint
  l, list                 - List all breakpoints
  
  p, print <var>   - Print variable value
  locals           - Show local variables
  globals          - Show global variables
  stack, bt        - Show call stack
  
  h, help          - Show this help
  q, quit          - Exit debugger
`);
  }

  checkBreakpoint(frame, ip) {
    const loc = frame.sourceMap && frame.sourceMap[ip];
    if (loc && this.hasBreakpoint(frame.sourcePath || this.sourcePath, loc.line)) {
      return true;
    }
    return false;
  }

  shouldPause(frame, ip) {
    if (this.stepMode === 'into') {
      return true;
    }
    if (this.stepMode === 'over' && this.vm.frames.length <= this.stepDepth) {
      return true;
    }
    if (this.stepMode === 'out' && this.vm.frames.length < this.stepDepth) {
      return true;
    }
    return false;
  }
}

async function debugFile(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error("❌ File not found:", absPath);
    process.exit(1);
  }

  const src = fs.readFileSync(absPath, 'utf-8');
  const lexer = new Lexer(src);
  const tokens = lexer.lex();
  const parser = new Parser(tokens, src);
  const stmts = parser.parseProgram();
  const compiler = new Compiler();
  const compiled = compiler.compile(stmts, { sourcePath: absPath });
  
  const vm = new VM(compiled.consts, compiled.code, { 
    baseDir: path.dirname(absPath),
    sourceMap: compiled.sourceMap,
    sourcePath: compiled.sourcePath
  });
  
  const dbg = new VexonDebugger(vm, absPath);
  
  console.log('Vexon Debugger - Type "help" for commands');
  console.log(`Loaded: ${filePath}\n`);
  console.log('Set breakpoints with: b <file> <line>');
  console.log('Or press "c" to run until completion\n');
  
  // Wrap VM.run to add debugging hooks
  const originalRun = vm.run.bind(vm);
  vm.run = async function() {
    const globalFrame = {
      code: vm.code,
      consts: vm.consts,
      ip: 0,
      locals: new Map(),
      baseDir: vm.baseDir,
      isGlobal: true,
      tryStack: [],
      module: null,
      sourceMap: vm.sourceMap,
      sourcePath: vm.sourcePath
    };

    if (vm.frames.length === 0) vm.frames.push(globalFrame);

    while (vm.frames.length > 0) {
      const frame = vm.frames[vm.frames.length - 1];
      
      if (frame.ip >= frame.code.length) {
        vm.frames.pop();
        continue;
      }

      // Check breakpoint
      if (dbg.checkBreakpoint(frame, frame.ip)) {
        const loc = frame.sourceMap && frame.sourceMap[frame.ip];
        console.log(`\n🔴 Breakpoint hit at ${frame.sourcePath}:${loc ? loc.line : '?'}`);
        await dbg.pause(frame, frame.ip);
      }

      // Check step mode
      if (dbg.shouldPause(frame, frame.ip)) {
        await dbg.pause(frame, frame.ip);
      }

      // Execute one instruction using original VM logic
      const inst = frame.code[frame.ip++];
      
      // We need to execute the instruction - call original implementation
      // For simplicity, we'll let the original run handle it by breaking here
      frame.ip--;
      vm.frames = [frame];
      
      // Execute single step
      try {
        await executeSingleInstruction(vm, frame);
      } catch (err) {
        console.error(`\n⚠️  Runtime error:`, err.message);
        await dbg.pause(frame, frame.ip - 1);
      }
    }
    
    return null;
  };

  // Helper to execute single instruction
  async function executeSingleInstruction(vm, frame) {
    const inst = frame.code[frame.ip++];
    // This is a simplified executor - in practice you'd need the full switch from VM
    // For now, just delegate to a temporary mini-run
    const tempVM = new VM(frame.consts, [inst, {op: 'HALT'}], {
      baseDir: frame.baseDir
    });
    tempVM.stack = [...vm.stack];
    tempVM.globals = vm.globals;
    await tempVM.run();
    vm.stack = [...tempVM.stack];
  }

  try {
    await vm.run();
    console.log('\n✓ Program completed');
  } catch (err) {
    console.error('\n❌ Program error:', err.message);
  }
  
  dbg.rl.close();
  process.exit(0);
}

/* ================ TYPE CHECKER ================ */

function typecheckFile(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error("❌ File not found:", absPath);
    process.exit(1);
  }

  const src = fs.readFileSync(absPath, 'utf-8');
  const lexer = new Lexer(src);
  const tokens = lexer.lex();
  const parser = new Parser(tokens, src);
  const stmts = parser.parseProgram();
  
  const checker = new TypeChecker(stmts, { strict: false });
  const result = checker.check();
  
  console.log(checker.formatReport());
  
  if (!result.success) {
    process.exit(1);
  }
}

/* ================ ELECTRON RUNTIME ================ */

if (process.argv.includes(ELECTRON_FLAG)) {
  const idx = process.argv.indexOf(ELECTRON_FLAG);
  const fileArg = process.argv[idx + 1];
  if (!fileArg) {
    console.error("❌ Electron runtime invoked without file path.");
    process.exit(1);
  }
  (async () => {
    try {
      await runElectronRuntime(path.resolve(fileArg));
    } catch (e) {
      console.error("❌ Electron runtime error:", e && e.stack ? e.stack : e);
      process.exit(1);
    }
  })();
  return;
}

/* ================ RUN FILE ================ */

async function runFile(filePath, options = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error("❌ File not found:", absPath);
    process.exit(1);
  }

  if (options.typecheck) {
    console.log("🔍 Type checking...");
    typecheckFile(absPath);
    console.log("✓ Type check passed\n");
  }

  const src = fs.readFileSync(absPath, "utf-8");
  try {
    const lexer = new Lexer(src);
    const tokens = lexer.lex();
    const parser = new Parser(tokens, src);
    const stmts = parser.parseProgram();
    const compiler = new Compiler();
    const compiled = compiler.compile(stmts, { sourcePath: absPath });

    const vm = new VM(compiled.consts, compiled.code, { 
      baseDir: path.dirname(absPath), 
      debug: !!options.debug,
      sourceMap: compiled.sourceMap,
      sourcePath: compiled.sourcePath
    });

    const usesGui = stmts.some(s => s.kind === "use" && s.name === "gui");

    if (usesGui) {
      spawnElectron(absPath);
      return;
    } else {
      await vm.run();
    }

  } catch (err) {
    console.error("❌ Vexon Error:", err && err.message ? err.message : String(err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

/* ================ ELECTRON SPAWN ================ */

function spawnElectron(entryFile) {
  const { spawn } = require("child_process");
  let electronBin = null;

  try {
    const em = require("electron");
    if (typeof em === "string") electronBin = em;
    else if (em && typeof em.path === "string") electronBin = em.path;
  } catch (e) {}

  if (!electronBin) {
    const local = path.resolve(
      process.cwd(),
      "node_modules",
      ".bin",
      process.platform === "win32" ? "electron.cmd" : "electron"
    );
    if (fs.existsSync(local)) electronBin = local;
  }

  if (!electronBin) {
    electronBin = process.platform === "win32" ? "electron.cmd" : "electron";
  }

  const args = [__filename, ELECTRON_FLAG, entryFile];

  console.log("[vexon] launching electron:");
  console.log("  bin :", electronBin);
  console.log("  args:", args.join(" "));

  const child = spawn(electronBin, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  child.on("error", (err) => {
    console.error("[vexon] Electron spawn failed:", err && err.message ? err.message : err);
    process.exit(1);
  });

  child.on("exit", (code) => process.exit(code));
}

/* ================ COMPILE ================ */

function compileToBytecode(filePath) {
  const absPath = path.resolve(filePath);
  const src = fs.readFileSync(absPath, "utf-8");
  const lexer = new Lexer(src);
  const tokens = lexer.lex();
  const parser = new Parser(tokens, src);
  const stmts = parser.parseProgram();
  const compiler = new Compiler();
  const compiled = compiler.compile(stmts);
  return { consts: compiled.consts, code: compiled.code, baseDir: path.dirname(absPath), stmts };
}

function compileToExe(filePath, options = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error("❌ File not found:", absPath);
    process.exit(1);
  }

  console.log("⚙️ Compiling:", path.basename(absPath));

  const bytecode = compileToBytecode(absPath);
  const usesGui = bytecode.stmts.some(s => s.kind === "use" && s.name === "gui");

  if (!usesGui) {
    const outJs = absPath.replace(/\.vx$/, "_build.js");
    const jsRunner = `#!/usr/bin/env node
"use strict";
const { VM } = require("./vexon_core.js");

const consts = ${JSON.stringify(bytecode.consts, null, 2)};
const code = ${JSON.stringify(bytecode.code, null, 2)};

(async () => {
  const vm = new VM(consts, code, { baseDir: ${JSON.stringify(bytecode.baseDir)}, debug: ${options.debug ? "true" : "false"} });
  try {
    await vm.run();
  } catch (err) {
    console.error("❌ Vexon Runtime Error:", err && err.message ? err.message : String(err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
`;
    fs.writeFileSync(outJs, jsRunner, "utf8");
    console.log("✓ Generated JS runner:", outJs);
    try {
      console.log("📦 Creating EXE with pkg...");
      child_process.execSync(`pkg "${outJs}" --targets node18-win-x64 --output "${absPath.replace(/\.vx$/, ".exe")}"`, { stdio: "inherit" });
      console.log("🎉 EXE created:", absPath.replace(/\.vx$/, ".exe"));
    } catch (e) {
      console.warn("⚠️ pkg not available - JS runner created. Run with: node " + path.basename(outJs));
    }
    return;
  }

  compileGuiExe(absPath, bytecode);
}

function compileGuiExe(entryFile, bytecode) {
  const outName = path.basename(entryFile, path.extname(entryFile));
  const buildDir = path.join(process.cwd(), ".vexon-build");
  if (fs.existsSync(buildDir)) {
    try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch (e) {}
  }
  fs.mkdirSync(buildDir, { recursive: true });

  fs.writeFileSync(path.join(buildDir, "app.vxb.js"), "module.exports = " + JSON.stringify({ consts: bytecode.consts, code: bytecode.code }) + ";\n", "utf8");
  const coreSrc = fs.readFileSync(path.resolve(__dirname, "vexon_core.js"), "utf8");
  fs.writeFileSync(path.join(buildDir, "vexon_core.js"), coreSrc, "utf8");

  const rendererJs = `const { ipcRenderer } = require("electron");
let WIDGETS = {};
ipcRenderer.on("render", (e, payload) => {
  const root = document.getElementById("root");
  if (!root) return;
  WIDGETS = payload.widgets || {};
  root.innerHTML = "";
  if (!payload.ui || !payload.ui.children) return;
  renderNode(payload.ui.children, root);
});

function renderNode(ids, parent) {
  for (const id of ids) {
    const w = WIDGETS[id];
    if (!w) continue;
    if (w.type === "button") {
      const b = document.createElement("button");
      b.textContent = w.text || "";
      if (w.style) Object.assign(b.style, w.style);
      b.onclick = () => ipcRenderer.send("event", id, "click");
      parent.appendChild(b);
    } else if (w.type === "label") {
      const d = document.createElement("div");
      d.textContent = w.text || "";
      if (w.style) Object.assign(d.style, w.style);
      parent.appendChild(d);
    } else if (w.type === "textbox") {
      const i = document.createElement("input");
      i.value = w.value || "";
      if (w.style) Object.assign(i.style, w.style);
      i.oninput = () => ipcRenderer.send("event", id, "change", i.value);
      parent.appendChild(i);
    } else if (w.type === "vbox" || w.type === "hbox") {
      const box = document.createElement("div");
      box.style.display = "flex";
      box.style.flexDirection = (w.type === "vbox") ? "column" : "row";
      if (w.style) Object.assign(box.style, w.style);
      parent.appendChild(box);
      renderNode(w.children || [], box);
    } else if (w.type === "canvas") {
      const c = document.createElement("canvas");
      c.width = w.width || 300;
      c.height = w.height || 150;
      c.style.border = "1px solid #222";
      if (w.style) Object.assign(c.style, w.style);
      parent.appendChild(c);
      const ctx = c.getContext("2d");
      if (w.ops && w.ops.length) {
        for (const op of w.ops) {
          if (op[0] === "rect") {
            ctx.fillStyle = op[5] || "black";
            ctx.fillRect(op[1], op[2], op[3], op[4]);
          } else if (op[0] === "circle") {
            ctx.fillStyle = op[4] || "black";
            ctx.beginPath();
            ctx.arc(op[1], op[2], op[3], 0, Math.PI*2);
            ctx.fill();
          } else if (op[0] === "text") {
            ctx.fillStyle = op[4] || "black";
            ctx.fillText(op[3], op[1], op[2]);
          } else if (op[0] === "line") {
            ctx.strokeStyle = op[5] || "black";
            ctx.lineWidth = op[6] || 1;
            ctx.beginPath();
            ctx.moveTo(op[1], op[2]);
            ctx.lineTo(op[3], op[4]);
            ctx.stroke();
          } else if (op[0] === "clearRect") {
            ctx.clearRect(op[1], op[2], op[3], op[4]);
          }
        }
      }
      c.onmousedown = e => ipcRenderer.send("mouse", id, "mousedown", e.offsetX, e.offsetY);
      c.onmousemove = e => ipcRenderer.send("mouse", id, "mousemove", e.offsetX, e.offsetY);
      c.onmouseup = e => ipcRenderer.send("mouse", id, "mouseup", e.offsetX, e.offsetY);
    }
  }
}

window.addEventListener("keydown", (e) => {
  const canon = e.key.toLowerCase();
  ipcRenderer.send("key", "keydown", e.key, canon);
});
window.addEventListener("keyup", (e) => {
  const canon = e.key.toLowerCase();
  ipcRenderer.send("key", "keyup", e.key, canon);
});
`;
  fs.writeFileSync(path.join(buildDir, "renderer.js"), rendererJs, "utf8");

  const mainJs = `const { app, BrowserWindow, ipcMain } = require("electron");
const { VM } = require("./vexon_core.js");
const bytecode = require("./app.vxb.js");

let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800, height: 600,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  mainWindow.loadURL("data:text/html," + encodeURIComponent('<!doctype html><html><body id="root"></body><script>require("./renderer.js")</script></html>'));

  const vm = new VM(bytecode.consts, bytecode.code, { baseDir: __dirname });

  vm.onGuiRender = (payload) => {
    try { mainWindow.webContents.send("render", payload); } catch (e) {}
  };

  ipcMain.on("event", (e, id, ev, arg) => {
    try { if (vm && typeof vm.__dispatchEvent === "function") vm.__dispatchEvent(id, ev, arg); } catch (ex) {}
  });

  ipcMain.on("mouse", (e, id, ev, x, y) => {
    try { if (vm && typeof vm.__dispatchEvent === "function") vm.__dispatchEvent(id, ev, x, y); } catch (ex) {}
  });

  ipcMain.on("key", (e, type, key, canon) => {
    try { if (vm && typeof vm.__dispatchGlobalKey === "function") vm.__dispatchGlobalKey(type, canon); } catch (ex) {}
  });

  (async () => {
    try { await vm.run(); } catch (err) { console.error("VM run error", err); }
  })();
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { app.quit(); });
`;
  fs.writeFileSync(path.join(buildDir, "main.js"), mainJs, "utf8");

  const packageJson = {
    name: outName,
    version: "0.1.0",
    main: "main.js",
    build: {
      appId: "org.vexon.app",
      win: { target: ["portable"] }
    }
  };
  fs.writeFileSync(path.join(buildDir, "package.json"), JSON.stringify(packageJson, null, 2), "utf8");

  console.log("📦 Building Electron app...");
  try {
    child_process.execSync("npx electron-builder --win portable", { cwd: buildDir, stdio: "inherit" });
    console.log("🎉 EXE created in .vexon-build/dist/");
  } catch (e) {
    console.error("❌ electron-builder failed. Ensure electron and electron-builder are installed.");
  }
}

/* ================ ELECTRON RUNTIME ================ */

async function runElectronRuntime(filePath) {
  const electron = require("electron");
  const { app, BrowserWindow, ipcMain } = electron;

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error("❌ File not found:", absPath);
    process.exit(1);
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:#fff;"><div id="root"></div><script>(function(){
  const { ipcRenderer } = require('electron');
  let WIDGETS = {};
  ipcRenderer.on('render', (e, payload) => {
    WIDGETS = payload.widgets || {};
    const root = document.getElementById('root');
    if (!root) return;
    root.innerHTML = '';
    if (!payload.ui || !payload.ui.children) return;
    renderNode(payload.ui.children, root);
  });

  function renderNode(ids, parent) {
    for (const id of ids) {
      const w = WIDGETS[id];
      if (!w) continue;
      if (w.type === 'button') {
        const b = document.createElement('button');
        b.textContent = w.text || '';
        if (w.style) Object.assign(b.style, w.style);
        b.onclick = () => ipcRenderer.send('event', id, 'click');
        parent.appendChild(b);
      } else if (w.type === 'label') {
        const d = document.createElement('div');
        d.textContent = w.text || '';
        if (w.style) Object.assign(d.style, w.style);
        parent.appendChild(d);
      } else if (w.type === 'textbox') {
        const i = document.createElement('input');
        i.value = w.value || '';
        if (w.style) Object.assign(i.style, w.style);
        i.oninput = () => ipcRenderer.send('event', id, 'change', i.value);
        parent.appendChild(i);
      } else if (w.type === 'vbox' || w.type === 'hbox') {
        const box = document.createElement('div');
        box.style.display = 'flex';
        box.style.flexDirection = (w.type === 'vbox') ? 'column' : 'row';
        if (w.style) Object.assign(box.style, w.style);
        parent.appendChild(box);
        renderNode(w.children || [], box);
      } else if (w.type === 'canvas') {
        const c = document.createElement('canvas');
        c.width = w.width || 300;
        c.height = w.height || 150;
        c.style.border = '1px solid #222';
        if (w.style) Object.assign(c.style, w.style);
        parent.appendChild(c);
        const ctx = c.getContext('2d');
        if (w.ops && w.ops.length) {
          for (const op of w.ops) {
            if (op[0] === 'rect') {
              ctx.fillStyle = op[5] || 'black';
              ctx.fillRect(op[1], op[2], op[3], op[4]);
            } else if (op[0] === 'circle') {
              ctx.fillStyle = op[4] || 'black';
              ctx.beginPath();
              ctx.arc(op[1], op[2], op[3], 0, Math.PI*2);
              ctx.fill();
            } else if (op[0] === 'text') {
              ctx.fillStyle = op[4] || 'black';
              ctx.fillText(op[3], op[1], op[2]);
            } else if (op[0] === 'line') {
              ctx.strokeStyle = op[5] || 'black';
              ctx.lineWidth = op[6] || 1;
              ctx.beginPath();
              ctx.moveTo(op[1], op[2]);
              ctx.lineTo(op[3], op[4]);
              ctx.stroke();
            } else if (op[0] === 'clearRect') {
              ctx.clearRect(op[1], op[2], op[3], op[4]);
            }
          }
        }
        c.onmousedown = e => ipcRenderer.send('mouse', id, 'mousedown', e.offsetX, e.offsetY);
        c.onmousemove = e => ipcRenderer.send('mouse', id, 'mousemove', e.offsetX, e.offsetY);
        c.onmouseup = e => ipcRenderer.send('mouse', id, 'mouseup', e.offsetX, e.offsetY);
      }
    }
  }

  window.addEventListener('keydown', (e) => {
    ipcRenderer.send('key', 'keydown', e.key, e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => {
    ipcRenderer.send('key', 'keyup', e.key, e.key.toLowerCase());
  });
})();</script></body></html>`;

  app.whenReady().then(() => {
    const mainWindow = new BrowserWindow({
      width: 900, height: 700,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    mainWindow.loadURL("data:text/html," + encodeURIComponent(html));

    try {
      const src = fs.readFileSync(absPath, "utf8");
      const lexer = new Lexer(src);
      const tokens = lexer.lex();
      const parser = new Parser(tokens, src);
      const stmts = parser.parseProgram();
      const compiler = new Compiler();
      const compiled = compiler.compile(stmts);

      const vm = new VM(compiled.consts, compiled.code, { baseDir: path.dirname(absPath) });

      vm.onGuiRender = (payload) => {
        try { mainWindow.webContents.send("render", payload); } catch (e) {}
      };

      ipcMain.on("event", (e, id, ev, arg) => {
        try { if (vm && typeof vm.__dispatchEvent === "function") vm.__dispatchEvent(id, ev, arg); } catch (ex) {}
      });
      ipcMain.on("mouse", (e, id, ev, x, y) => {
        try { if (vm && typeof vm.__dispatchEvent === "function") vm.__dispatchEvent(id, ev, x, y); } catch (ex) {}
      });
      ipcMain.on("key", (e, type, key, canon) => {
        try { if (vm && typeof vm.__dispatchGlobalKey === "function") vm.__dispatchGlobalKey(type, canon); } catch (ex) {}
      });

      (async () => {
        try { await vm.run(); } catch (err) { console.error("VM error:", err); }
      })();

    } catch (e) {
      console.error("❌ Failed to start:", e);
    }
  });

  app.on("window-all-closed", () => app.quit());
}

/* ================ CLI HANDLER ================ */

const args = process.argv.slice(2);
const cmd = args[0];
const fileArg = args[1];
const debug = args.includes("--debug");
const typecheck = args.includes("--typecheck");

(async () => {
  switch (cmd) {
    case "run":
      if (!fileArg) { console.error("❌ No file specified"); process.exit(1); }
      await runFile(fileArg, { debug, typecheck });
      break;

    case "compile":
      if (!fileArg) { console.error("❌ No file specified"); process.exit(1); }
      compileToExe(fileArg, { debug });
      break;

    case "debug":
      if (!fileArg) { console.error("❌ No file specified"); process.exit(1); }
      await debugFile(fileArg);
      break;

    case "typecheck":
    case "check":
      if (!fileArg) { console.error("❌ No file specified"); process.exit(1); }
      typecheckFile(fileArg);
      break;

    default:
      console.log("Vexon Language CLI v0.4.1");
      console.log("-------------------------");
      console.log("Commands:");
      console.log("  run <file.vx> [--typecheck]  - Run a program");
      console.log("  debug <file.vx>              - Debug with breakpoints");
      console.log("  typecheck <file.vx>          - Type check only");
      console.log("  compile <file.vx>            - Compile to EXE");
      console.log("");
      console.log("Examples:");
      console.log("  node vexon_cli.js run app.vx");
      console.log("  node vexon_cli.js debug app.vx");
      console.log("  node vexon_cli.js run app.vx --typecheck");
      break;
  }
})();
