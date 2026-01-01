#!/usr/bin/env node
// vexon_cli.js — final merged for Vexon 0.4.1
// CLI: run, compile (including GUI EXE bundling with Electron)
// Architecture:
//  - Node CLI handles compile/run commands.
//  - For GUI runs, CLI spawns the Electron binary to run this same script with "--vexon-electron <file>".
//  - When launched by Electron with that flag, script enters Electron runtime mode (uses app.whenReady()).

"use strict";

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const { Lexer, Parser, Compiler, VM } = require(path.join(__dirname, 'vexon_core.cells_ordered.js'));
const os = require("os");

// ---------- Electron spawn / runtime flag ----------
const ELECTRON_FLAG = "--vexon-electron";

// If this process was launched by Electron runtime mode, handle it here and exit after.
if (process.argv.includes(ELECTRON_FLAG)) {
  const idx = process.argv.indexOf(ELECTRON_FLAG);
  const fileArg = process.argv[idx + 1];
  if (!fileArg) {
    console.error("❌ Electron runtime invoked without file path.");
    process.exit(1);
  }
  // Run the Electron runtime — this uses real Electron APIs (app, BrowserWindow, ipcMain)
  (async () => {
    try {
      await runElectronRuntime(path.resolve(fileArg));
    } catch (e) {
      console.error("❌ Electron runtime error:", e && e.stack ? e.stack : e);
      process.exit(1);
    }
  })();
  // Prevent the rest of CLI from executing in this branch.
  return;
}

// ---------------- Primary CLI logic ----------------

async function runFile(filePath, options = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error("❌ File not found:", absPath);
    process.exit(1);
  }

  const src = fs.readFileSync(absPath, "utf-8");
  try {
    // lex/parse/compile
    const lexer = new Lexer(src);
    const tokens = lexer.lex();

    const parser = new Parser(tokens, src);
    const stmts = parser.parseProgram();

    const compiler = new Compiler();
    const compiled = compiler.compile(stmts);
    const { consts, code } = compiled;

    const programDir = path.dirname(absPath);

    // Create VM
    const vm = new VM(consts, code, {
      baseDir: programDir,
      debug: !!options.debug
    });

    // --- APPLY KERNEL from runtime directory (always load from __dirname) ---
    try {
      const runtimeKernel = path.join(__dirname, "vexon_cell1.js");
      if (fs.existsSync(runtimeKernel)) {
        try {
          require(runtimeKernel)(vm);
        } catch (e) {
          console.error("❌ Failed to apply runtime kernel:", e && e.stack ? e.stack : e);
        }
      } else {
        console.warn("⚠️ Runtime kernel not found at", runtimeKernel);
      }
    } catch (e) {
      if (options.debug) console.error("⚠️ Kernel apply error:", e);
    }

    // --- Optionally load any program-local cells (vexon_cell*.js in programDir) ---
    try {
      const programCells = fs.readdirSync(programDir)
        .filter(f => /^vexon_cell.*\.js$/.test(f))
        .map(f => path.join(programDir, f));
      for (const f of programCells) {
        try {
          // avoid re-applying runtime kernel if programDir happens to contain one with same name
          if (path.resolve(f) === path.resolve(path.join(__dirname, "vexon_cell1.js"))) continue;
          require(f)(vm);
        } catch (e) {
          if (options.debug) console.error("⚠️ Failed to apply program cell:", f, e && e.stack ? e.stack : e);
        }
      }
    } catch (e) {
      if (options.debug) console.error("⚠️ Failed scanning program dir for cells:", e);
    }

    // If program uses GUI, spawn electron (so Electron process will re-apply kernel from runtime)
    const usesGui = stmts.some(s => s.kind === "use" && s.name === "gui");
    if (usesGui) {
      spawnElectron(absPath);
      return;
    }

    // Run the VM (non-GUI)
    try {
      await vm.run();
    } catch (runErr) {
      // vm.run errors should already create error widgets via kernel's wrapper, rethrow/log here
      if (options.debug) {
        console.error("❌ VM run error:", runErr && runErr.stack ? runErr.stack : runErr);
      }
      // Let the outer catch handle final reporting & exit
      throw runErr;
    }

  } catch (err) {
    console.error("❌ Vexon Error:", err && err.message ? err.message : String(err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

// ---------- spawnElectron ----------
// Spawns the electron binary (installed in node_modules) to run this script in Electron runtime mode.
function spawnElectron(entryFile) {
  let electronBin;
  try {
    // when required from Node, 'electron' package exports the path to the binary — suitable for spawn
    electronBin = require("electron");
  } catch (e) {
    console.error("❌ Electron is required for GUI mode. Install with: npm install electron --save-dev");
    process.exit(1);
  }

  const args = [__filename, ELECTRON_FLAG, entryFile];
  console.log("⚡ Spawning Electron for GUI run...");
  const child = child_process.spawn(electronBin, args, { stdio: "inherit" });

  child.on("close", (code) => {
    process.exit(code === null ? 0 : code);
  });

  child.on("error", (err) => {
    console.error("❌ Failed to spawn Electron:", err);
    process.exit(1);
  });
}


// ---------- compile helpers (unchanged, but kept) ----------
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
    // generate JS runner and optionally try to pkg it
    const outJs = absPath.replace(/\.vx$/, "_build.js");
    const jsRunner = `#!/usr/bin/env node
"use strict";
const path = require("path");
const fs = require("fs");
const { VM } = require(path.join(__dirname, 'vexon_core.cells_ordered.js'));

const consts = ${JSON.stringify(bytecode.consts, null, 2)};
const code = ${JSON.stringify(bytecode.code, null, 2)};

(async () => {
  const baseDir = ${JSON.stringify(bytecode.baseDir)};
  const vm = new VM(consts, code, { baseDir: baseDir, debug: ${options.debug ? "true" : "false"} });
  try {
    const kernelPath = path.join(__dirname, 'vexon_cell1.js');
    if (fs.existsSync(kernelPath)) {
      try { require(kernelPath)(vm); } catch(e) { console.error("Failed to apply kernel:", e && e.stack ? e.stack : e); }
    }
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
      console.log("📦 Creating EXE with pkg (node18-win-x64)...");
      child_process.execSync(`pkg "${outJs}" --targets node18-win-x64 --output "${absPath.replace(/\.vx$/, ".exe")}"`, { stdio: "inherit" });
      console.log("🎉 EXE created:", absPath.replace(/\.vx$/, ".exe"));
    } catch (e) {
      console.warn("⚠️ pkg not available or failed — JS runner created. You can run it with node.");
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
      if (w.style) applyStyle(b, w.style);
      b.onclick = () => ipcRenderer.send("event", id, "click");
      parent.appendChild(b);
    } else if (w.type === "label") {
      const d = document.createElement("div");
      d.textContent = w.text || "";
      if (w.style) applyStyle(d, w.style);
      parent.appendChild(d);
    } else if (w.type === "textbox") {
      const i = document.createElement("input");
      i.value = w.value || "";
      if (w.style) applyStyle(i, w.style);
      i.oninput = () => ipcRenderer.send("event", id, "change", i.value);
      parent.appendChild(i);
    } else if (w.type === "vbox" || w.type === "hbox") {
      const box = document.createElement("div");
      box.style.display = "flex";
      box.style.flexDirection = (w.type === "vbox") ? "column" : "row";
      if (w.style) applyStyle(box, w.style);
      parent.appendChild(box);
      renderNode(w.children || [], box);
    } else if (w.type === "canvas") {
      const c = document.createElement("canvas");
      c.width = w.width || 300;
      c.height = w.height || 150;
      c.style.border = "1px solid #222";
      if (w.style) applyStyle(c, w.style);
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
          } else if (op[0] === "image") {
            const imgId = String(op[1]);
            if (!window.__IMG_CACHE) window.__IMG_CACHE = {};
            const meta = WIDGETS[imgId];
            if (!meta) continue;
            if (!window.__IMG_CACHE[imgId]) {
              const im = new Image();
              im.src = meta.path;
              window.__IMG_CACHE[imgId] = im;
              im.onload = () => { ipcRenderer.send("frame"); };
            }
            const im = window.__IMG_CACHE[imgId];
            if (im && im.complete) {
              if (op[4] == null) ctx.drawImage(im, op[2], op[3]);
              else ctx.drawImage(im, op[2], op[3], op[4], op[5]);
            }
          } else if (op[0] === "line") {
            ctx.strokeStyle = op[5] || "black";
            ctx.lineWidth = op[6] || 1;
            ctx.beginPath();
            ctx.moveTo(op[1], op[2]);
            ctx.lineTo(op[3], op[4]);
            ctx.stroke();
          } else if (op[0] === "triangle") {
            ctx.fillStyle = op[7] || "black";
            ctx.beginPath();
            ctx.moveTo(op[1], op[2]);
            ctx.lineTo(op[3], op[4]);
            ctx.lineTo(op[5], op[6]);
            ctx.closePath();
            ctx.fill();
          } else if (op[0] === "arc") {
            ctx.fillStyle = op[6] || "black";
            ctx.beginPath();
            ctx.arc(op[1], op[2], op[3], op[4], op[5]);
            ctx.fill();
          } else if (op[0] === "clearRect") {
            ctx.clearRect(op[1], op[2], op[3], op[4]);
          }
        }
      }
      c.onmousedown = e => ipcRenderer.send("mouse", id, "mousedown", e.offsetX, e.offsetY);
      c.onmousemove = e => ipcRenderer.send("mouse", id, "mousemove", e.offsetX, e.offsetY);
      c.onmouseup = e => ipcRenderer.send("mouse", id, "mouseup", e.offsetX, e.offsetY);
    } else if (w.type === "image") {
      // invisible: images are referenced by canvas drawImage
    }
  }
}

function applyStyle(el, style) {
  for (const k of Object.keys(style)) {
    try { el.style[k] = style[k]; } catch (e) {}
  }
}

ipcRenderer.on("frame", () => {});
// global key events -> forward to main with a canonical (lowercased) key argument
window.addEventListener("keydown", (e) => {
  try {
    const raw = e.key;
    const canon = (raw && raw.toLowerCase) ? raw.toLowerCase() : String(raw || "").toLowerCase();
    ipcRenderer.send("key", "keydown", raw, canon);
  } catch (err) {}
});
window.addEventListener("keyup", (e) => {
  try {
    const raw = e.key;
    const canon = (raw && raw.toLowerCase) ? raw.toLowerCase() : String(raw || "").toLowerCase();
    ipcRenderer.send("key", "keyup", raw, canon);
  } catch (err) {}
});
`;
  fs.writeFileSync(path.join(buildDir, "renderer.js"), rendererJs, "utf8");

  const mainJs = `const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");
const { VM } = require(path.join(__dirname, 'vexon_core.cells_ordered.js'));
const bytecode = require("./app.vxb.js");

let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800, height: 600,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  mainWindow.loadURL("data:text/html," + encodeURIComponent('<!doctype html><html><body id="root"></body><script>require("./renderer.js")</script></html>'));

  const programDir = __dirname;
  let cellFiles = [];
  try { cellFiles = fs.readdirSync(programDir).filter(f => /^vexon_cell.*\\.js$/.test(f)).map(f => path.join(programDir, f)); } catch(e) {}
  const vm = new VM(bytecode.consts, bytecode.code, { baseDir: programDir });

  // APPLY KERNEL (for packaged GUI builds)
  try {
    const kernelPath = path.join(__dirname, 'vexon_cell1.js');
    if (fs.existsSync(kernelPath)) {
      try { require(kernelPath)(vm); } catch(e) { console.error('Failed to apply kernel:', e && e.stack ? e.stack : e); }
    } else if (Array.isArray(cellFiles) && cellFiles.length) {
      for (const f of cellFiles) { try { require(f)(vm); } catch(e) {} }
    }
  } catch (e) { console.error('Kernel apply failed in packaged main.js', e); }

  vm.onGuiRender = (payload) => {
    try {
      mainWindow.webContents.send("render", payload);
    } catch (e) {}
  };

  ipcMain.on("event", (e, id, ev, arg) => {
    try {
      if (vm && typeof vm.__dispatchEvent === "function") vm.__dispatchEvent(id, ev, arg);
    } catch (ex) { console.error("ipc event dispatch error", ex); }
  });

  ipcMain.on("mouse", (e, id, ev, x, y) => {
    try {
      if (vm && typeof vm.__dispatchEvent === "function") vm.__dispatchEvent(id, ev, x, y);
    } catch (ex) { console.error("ipc mouse dispatch error", ex); }
  });

  ipcMain.on("key", (e, type, key, canon) => {
    try {
      const k = (canon && canon !== "") ? canon : key;
      if (vm && typeof vm.__dispatchGlobalKey === "function") vm.__dispatchGlobalKey(type, k);
    } catch (ex) { console.error("ipc key dispatch error", ex); }
  });

  (async () => {
    try {
      await vm.run();
    } catch (err) { console.error("VM run error", err); }
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
    scripts: {},
    build: {
      appId: "org.vexon.app",
      win: { target: ["portable","nsis"] },
      directories: { output: "dist" }
    }
  };
  fs.writeFileSync(path.join(buildDir, "package.json"), JSON.stringify(packageJson, null, 2), "utf8");

  console.log("📦 Building Electron app in:", buildDir);
  try {
    child_process.execSync("npx electron-builder --win portable", { cwd: buildDir, stdio: "inherit" });
    console.log("🎉 EXE created in build/dist (check the dist folder inside .vexon-build)");
  } catch (e) {
    console.error("❌ electron-builder failed. Ensure electron and electron-builder are installed as devDependencies.");
    console.error(e && e.message ? e.message : e);
  }
}

// ---------- Electron runtime mode (executed when Electron spawns this script with --vexon-electron file) ----------
async function runElectronRuntime(filePath) {
  // When this function runs, the process is the Electron process — require('electron') yields the real API.
  const electron = require("electron");
  const { app, BrowserWindow, ipcMain } = electron;

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error("❌ File not found (Electron runtime):", absPath);
    process.exit(1);
  }

  // Tiny inline renderer HTML — listens for "render" and sends events back.
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:#fff;font-family:Segoe UI,Arial,Helvetica,sans-serif;"><div id="root" style="padding:10px;"></div><script>(function(){
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
        c.width = w.width || 300; c.height = w.height || 150;
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
            } else if (op[0] === 'image') {
              const imgId = String(op[1]);
              if (!window.__IMG_CACHE) window.__IMG_CACHE = {};
              const meta = WIDGETS[imgId];
              if (!meta) continue;
              if (!window.__IMG_CACHE[imgId]) {
                const im = new Image();
                im.src = meta.path;
                window.__IMG_CACHE[imgId] = im;
                im.onload = () => { ipcRenderer.send('frame'); };
              }
              const im = window.__IMG_CACHE[imgId];
              if (im && im.complete) {
                if (op[4] == null) ctx.drawImage(im, op[2], op[3]);
                else ctx.drawImage(im, op[2], op[3], op[4], op[5]);
              }
            } else if (op[0] === 'line') {
              ctx.strokeStyle = op[5] || 'black';
              ctx.lineWidth = op[6] || 1;
              ctx.beginPath();
              ctx.moveTo(op[1], op[2]);
              ctx.lineTo(op[3], op[4]);
              ctx.stroke();
            } else if (op[0] === 'triangle') {
              ctx.fillStyle = op[7] || 'black';
              ctx.beginPath();
              ctx.moveTo(op[1], op[2]);
              ctx.lineTo(op[3], op[4]);
              ctx.lineTo(op[5], op[6]);
              ctx.closePath();
              ctx.fill();
            } else if (op[0] === 'arc') {
              ctx.fillStyle = op[6] || 'black';
              ctx.beginPath();
              ctx.arc(op[1], op[2], op[3], op[4], op[5]);
              ctx.fill();
            } else if (op[0] === 'clearRect') {
              ctx.clearRect(op[1], op[2], op[3], op[4]);
            }
          }
        }
        c.onmousedown = e => ipcRenderer.send('mouse', id, 'mousedown', e.offsetX, e.offsetY);
        c.onmousemove = e => ipcRenderer.send('mouse', id, 'mousemove', e.offsetX, e.offsetY);
        c.onmouseup = e => ipcRenderer.send('mouse', id, 'mouseup', e.offsetX, e.offsetY);
      } else if (w.type === 'image') {
        // invisible: images are referenced by canvas drawImage
      }
    }
  }

  // forward key events to main so vm.__dispatchGlobalKey receives them
  window.addEventListener('keydown', (e) => {
    try {
      const raw = e.key;
      const canon = (raw && raw.toLowerCase) ? raw.toLowerCase() : String(raw || "").toLowerCase();
      ipcRenderer.send('key', 'keydown', raw, canon);
    } catch (err) {}
  });
  window.addEventListener('keyup', (e) => {
    try {
      const raw = e.key;
      const canon = (raw && raw.toLowerCase) ? raw.toLowerCase() : String(raw || "").toLowerCase();
      ipcRenderer.send('key', 'keyup', raw, canon);
    } catch (err) {}
  });

})();</script></body></html>`;

  // Create window after app ready
  app.whenReady().then(() => {
    const mainWindow = new BrowserWindow({
      width: 900, height: 700,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    mainWindow.loadURL("data:text/html," + encodeURIComponent(html));

    // Now compile the Vexon file and run the VM
    try {
      const src = fs.readFileSync(absPath, "utf8");
      const lexer = new Lexer(src);
      const tokens = lexer.lex();
      const parser = new Parser(tokens, src);
      const stmts = parser.parseProgram();
      const compiler = new Compiler();
      const compiled = compiler.compile(stmts);

      const programDir = path.dirname(absPath);
      let cellFiles = [];
      try { cellFiles = fs.readdirSync(programDir).filter(f => /^vexon_cell.*\.js$/.test(f)).map(f => path.join(programDir, f)); } catch(e) {}
      const vm = new VM(compiled.consts, compiled.code, { baseDir: programDir });

      // APPLY KERNEL for Electron runtime
      try {
        const kernelPath = path.join(__dirname, 'vexon_cell1.js');
        if (fs.existsSync(kernelPath)) {
          try { require(kernelPath)(vm); } catch (e) { console.error("❌ Failed to apply kernel:", e && e.stack ? e.stack : e); }
        } else if (Array.isArray(cellFiles) && cellFiles.length) {
          for (const f of cellFiles) { try { require(f)(vm); } catch(e) {} }
        }
      } catch (e) { console.error('Kernel apply failed in Electron runtime', e); }

      // When VM serializes UI, forward to renderer
      vm.onGuiRender = (payload) => {
        try { mainWindow.webContents.send("render", payload); } catch (e) {}
      };

      // Wire renderer events to VM
      ipcMain.on("event", (e, id, ev, arg) => {
        try { if (vm && typeof vm.__dispatchEvent === "function") vm.__dispatchEvent(id, ev, arg); } catch (ex) { console.error("ipc event dispatch error", ex); }
      });
      ipcMain.on("mouse", (e, id, ev, x, y) => {
        try { if (vm && typeof vm.__dispatchEvent === "function") vm.__dispatchEvent(id, ev, x, y); } catch (ex) { console.error("ipc mouse dispatch error", ex); }
      });
      ipcMain.on("key", (e, type, key, canon) => {
        try { const k = (canon && canon !== "") ? canon : key; if (vm && typeof vm.__dispatchGlobalKey === "function") vm.__dispatchGlobalKey(type, k); } catch (ex) { console.error("ipc key dispatch error", ex); }
      });

      // Run the VM (async)
      (async () => {
        try {
          await vm.run();
        } catch (err) {
          console.error("VM run error:", err);
        }
      })();

    } catch (e) {
      console.error("❌ Failed to start VM in Electron runtime:", e && e.stack ? e.stack : e);
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}

// ---------------- CLI handler ----------------
const args = process.argv.slice(2);
const cmd = args[0];
const fileArg = args[1];
const debug = args.includes("--debug");

(async () => {
  switch (cmd) {
    case "run":
      if (!fileArg) { console.error("❌ No file specified for 'run'"); process.exit(1); }
      await runFile(fileArg, { debug });
      break;

    case "compile":
      if (!fileArg) { console.error("❌ No file specified for 'compile'"); process.exit(1); }
      compileToExe(fileArg, { debug });
      break;

    default:
      console.log("Vexon Language CLI");
      console.log("------------------");
      console.log("Run a program:");
      console.log("   node vexon_cli.js run <file.vx> [--debug]");
      console.log("");
      console.log("Compile to EXE:");
      console.log("   node vexon_cli.js compile <file.vx> [--debug]");
      break;
  }
})();
