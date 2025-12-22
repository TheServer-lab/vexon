#!/usr/bin/env node
// vexon_cli.corrected.full.js — Fully corrected Vexon 0.4.1 CLI
// - Fixed syntax errors
// - Writes index.html + renderer.js into .vexon-build for GUI builds
// - main.js uses loadFile(path.join(__dirname, 'index.html')) instead of data URI requiring ./renderer.js
// - Ensures ipcMain listeners are attached before VM.run and waits for did-finish-load before starting VM
// - More robust electron spawn detection and improved error logging

'use strict';

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const os = require('os');
const { Lexer, Parser, Compiler, VM } = require('./vexon_core.js');

const ELECTRON_FLAG = '--vexon-electron';

// If this process was launched by Electron runtime mode, handle it here and exit after.
if (process.argv.includes(ELECTRON_FLAG)) {
  const idx = process.argv.indexOf(ELECTRON_FLAG);
  const fileArg = process.argv[idx + 1];
  if (!fileArg) {
    console.error('❌ Electron runtime invoked without file path.');
    process.exit(1);
  }
  (async () => {
    try {
      await runElectronRuntime(path.resolve(fileArg));
    } catch (e) {
      console.error('❌ Electron runtime error:', e && e.stack ? e.stack : e);
      process.exit(1);
    }
  })();
  // don't fall through to CLI handler
  return;
}

// ---------------- Primary CLI logic ----------------

async function runFile(filePath, options = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error('❌ File not found:', absPath);
    process.exit(1);
  }

  const src = fs.readFileSync(absPath, 'utf-8');
  try {
    const lexer = new Lexer(src);
    const tokens = lexer.lex();

    const parser = new Parser(tokens, src);
    const stmts = parser.parseProgram();

    const compiler = new Compiler();
    const compiled = compiler.compile(stmts);

    const vm = new VM(compiled.consts, compiled.code, { baseDir: path.dirname(absPath), debug: !!options.debug });

    // If program used 'use gui' we will spawn electron process (not call Electron APIs here)
    const usesGui = stmts.some(s => s.kind === 'use' && s.name === 'gui');

    if (usesGui) {
      spawnElectron(absPath);
      return;
    } else {
      await vm.run();
    }

  } catch (err) {
    console.error('❌ Vexon Error:', err && err.message ? err.message : String(err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

// ---------- spawnElectron ----------
function spawnElectron(entryFile) {
  let electronBin = null;
  try {
    const electronReq = require('electron');
    if (typeof electronReq === 'string') electronBin = electronReq;
    else if (electronReq && electronReq.path) electronBin = electronReq.path;
    else electronBin = path.join(process.cwd(), 'node_modules', '.bin', 'electron');
  } catch (e) {
    console.error('❌ Electron is required for GUI mode. Install with: npm install --save-dev electron');
    process.exit(1);
  }

  const args = [__filename, ELECTRON_FLAG, entryFile];
  console.log('⚡ Spawning Electron for GUI run...', electronBin, args.join(' '));
  const child = child_process.spawn(electronBin, args, { stdio: 'inherit' });

  child.on('close', (code) => {
    process.exit(code === null ? 0 : code);
  });

  child.on('error', (err) => {
    console.error('❌ Failed to spawn Electron:', err);
    console.error('Tried to spawn:', electronBin);
    console.error('If you installed electron locally, try: ./node_modules/.bin/electron', __filename, ELECTRON_FLAG, entryFile);
    process.exit(1);
  });
}

// ---------- compile helpers ----------
function compileToBytecode(filePath) {
  const absPath = path.resolve(filePath);
  const src = fs.readFileSync(absPath, 'utf-8');
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
    console.error('❌ File not found:', absPath);
    process.exit(1);
  }

  console.log('⚙️ Compiling:', path.basename(absPath));

  const bytecode = compileToBytecode(absPath);
  const usesGui = bytecode.stmts.some(s => s.kind === 'use' && s.name === 'gui');

  if (!usesGui) {
    // generate JS runner and optionally try to pkg it
    const outJs = absPath.replace(/\.vx$/, '_build.js');
    const jsRunner = `#!/usr/bin/env node\n"use strict";\nconst { VM } = require('./vexon_core.js');\n\nconst consts = ${JSON.stringify(bytecode.consts, null, 2)};\nconst code = ${JSON.stringify(bytecode.code, null, 2)};\n\n(async () => {\n  const vm = new VM(consts, code, { baseDir: ${JSON.stringify(bytecode.baseDir)}, debug: ${options.debug ? 'true' : 'false'} });\n  try {\n    await vm.run();\n  } catch (err) {\n    console.error('❌ Vexon Runtime Error:', err && err.message ? err.message : String(err));\n    if (err && err.stack) console.error(err.stack);\n    process.exit(1);\n  }\n})();\n`;
    fs.writeFileSync(outJs, jsRunner, 'utf8');
    console.log('✓ Generated JS runner:', outJs);
    try {
      console.log('📦 Creating EXE with pkg (node18-win-x64)...');
      child_process.execSync(`pkg "${outJs}" --targets node18-win-x64 --output "${absPath.replace(/\.vx$/, '.exe')}"`, { stdio: 'inherit' });
      console.log('🎉 EXE created:', absPath.replace(/\.vx$/, '.exe'));
    } catch (e) {
      console.warn('⚠️ pkg not available or failed — JS runner created. You can run it with node.');
    }
    return;
  }

  compileGuiExe(absPath, bytecode);
}

function compileGuiExe(entryFile, bytecode) {
  const outName = path.basename(entryFile, path.extname(entryFile));
  const buildDir = path.join(process.cwd(), '.vexon-build');
  if (fs.existsSync(buildDir)) {
    try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch (e) {}
  }
  fs.mkdirSync(buildDir, { recursive: true });

  // write bytecode module and core
  fs.writeFileSync(path.join(buildDir, 'app.vxb.js'), 'module.exports = ' + JSON.stringify({ consts: bytecode.consts, code: bytecode.code }) + ';\n', 'utf8');
  const coreSrc = fs.readFileSync(path.resolve(__dirname, 'vexon_core.js'), 'utf8');
  fs.writeFileSync(path.join(buildDir, 'vexon_core.js'), coreSrc, 'utf8');

  // renderer.js
  const rendererJs = `const { ipcRenderer } = require('electron');\nlet WIDGETS = {};\nipcRenderer.on('render', (e, payload) => {\n  WIDGETS = payload.widgets || {};\n  const root = document.getElementById('root');\n  if (!root) return;\n  root.innerHTML = '';\n  if (!payload.ui || !payload.ui.children) return;\n  renderNode(payload.ui.children, root);\n});\n\nfunction renderNode(ids, parent) {\n  for (const id of ids) {\n    const w = WIDGETS[id];\n    if (!w) continue;\n    if (w.type === 'button') {\n      const b = document.createElement('button');\n      b.textContent = w.text || '';\n      if (w.style) applyStyle(b, w.style);\n      b.onclick = () => ipcRenderer.send('event', id, 'click');\n      parent.appendChild(b);\n    } else if (w.type === 'label') {\n      const d = document.createElement('div');\n      d.textContent = w.text || '';\n      if (w.style) applyStyle(d, w.style);\n      parent.appendChild(d);\n    } else if (w.type === 'textbox') {\n      const i = document.createElement('input');\n      i.value = w.value || '';\n      if (w.style) applyStyle(i, w.style);\n      i.oninput = () => ipcRenderer.send('event', id, 'change', i.value);\n      parent.appendChild(i);\n    } else if (w.type === 'vbox' || w.type === 'hbox') {\n      const box = document.createElement('div');\n      box.style.display = 'flex';\n      box.style.flexDirection = (w.type === 'vbox') ? 'column' : 'row';\n      if (w.style) applyStyle(box, w.style);\n      parent.appendChild(box);\n      renderNode(w.children || [], box);\n    } else if (w.type === 'canvas') {\n      const c = document.createElement('canvas');\n      c.width = w.width || 300; c.height = w.height || 150;\n      c.style.border = '1px solid #222';\n      if (w.style) applyStyle(c, w.style);\n      parent.appendChild(c);\n      const ctx = c.getContext('2d');\n      if (w.ops && w.ops.length) {\n        for (const op of w.ops) {\n          if (op[0] === 'rect') { ctx.fillStyle = op[5] || 'black'; ctx.fillRect(op[1], op[2], op[3], op[4]); }\n          else if (op[0] === 'circle') { ctx.fillStyle = op[4] || 'black'; ctx.beginPath(); ctx.arc(op[1], op[2], op[3], 0, Math.PI*2); ctx.fill(); }\n          else if (op[0] === 'text') { ctx.fillStyle = op[4] || 'black'; ctx.fillText(op[3], op[1], op[2]); }\n          else if (op[0] === 'image') { const imgId = String(op[1]); if (!window.__IMG_CACHE) window.__IMG_CACHE = {}; const meta = WIDGETS[imgId]; if (!meta) continue; if (!window.__IMG_CACHE[imgId]) { const im = new Image(); im.src = meta.path; window.__IMG_CACHE[imgId] = im; im.onload = () => { ipcRenderer.send('frame'); }; } const im = window.__IMG_CACHE[imgId]; if (im && im.complete) { if (op[4] == null) ctx.drawImage(im, op[2], op[3]); else ctx.drawImage(im, op[2], op[3], op[4], op[5]); } }\n          else if (op[0] === 'line') { ctx.strokeStyle = op[5] || 'black'; ctx.lineWidth = op[6] || 1; ctx.beginPath(); ctx.moveTo(op[1], op[2]); ctx.lineTo(op[3], op[4]); ctx.stroke(); }\n          else if (op[0] === 'triangle') { ctx.fillStyle = op[7] || 'black'; ctx.beginPath(); ctx.moveTo(op[1], op[2]); ctx.lineTo(op[3], op[4]); ctx.lineTo(op[5], op[6]); ctx.closePath(); ctx.fill(); }\n          else if (op[0] === 'arc') { ctx.fillStyle = op[6] || 'black'; ctx.beginPath(); ctx.arc(op[1], op[2], op[3], op[4], op[5]); ctx.fill(); }\n          else if (op[0] === 'clearRect') { ctx.clearRect(op[1], op[2], op[3], op[4]); }\n        }\n      }\n      c.onmousedown = e => ipcRenderer.send('mouse', id, 'mousedown', e.offsetX, e.offsetY);\n      c.onmousemove = e => ipcRenderer.send('mouse', id, 'mousemove', e.offsetX, e.offsetY);\n      c.onmouseup = e => ipcRenderer.send('mouse', id, 'mouseup', e.offsetX, e.offsetY);\n    }\n  }\n}\n\nfunction applyStyle(el, style) { for (const k of Object.keys(style)) { try { el.style[k] = style[k]; } catch (e) {} } }\n\nipcRenderer.on('frame', () => {});\nwindow.addEventListener('keydown', (e) => { try { const raw = e.key; const canon = (raw && raw.toLowerCase) ? raw.toLowerCase() : String(raw || '').toLowerCase(); ipcRenderer.send('key', 'keydown', raw, canon); } catch (err) {} });\nwindow.addEventListener('keyup', (e) => { try { const raw = e.key; const canon = (raw && raw.toLowerCase) ? raw.toLowerCase() : String(raw || '').toLowerCase(); ipcRenderer.send('key', 'keyup', raw, canon); } catch (err) {} });\n`;
  fs.writeFileSync(path.join(buildDir, 'renderer.js'), rendererJs, 'utf8');

  // index.html referencing renderer.js
  const indexHtml = `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;">\n  <title>${outName}</title>\n  <style>body{margin:0;background:#111;color:#fff;font-family:Segoe UI,Arial,Helvetica,sans-serif;padding:10px;} button{margin:4px;padding:6px 10px;border-radius:6px;} </style>\n</head>\n<body>\n  <div id="root"></div>\n  <script>require('./renderer.js');</script>\n</body>\n</html>\n`;
  fs.writeFileSync(path.join(buildDir, 'index.html'), indexHtml, 'utf8');

  // main.js loads index.html from disk
  const mainJs = `const { app, BrowserWindow, ipcMain } = require('electron');\nconst { VM } = require('./vexon_core.js');\nconst bytecode = require('./app.vxb.js');\nconst path = require('path');\n\nlet mainWindow = null;\nlet vm = null;\nfunction createWindow() {\n  mainWindow = new BrowserWindow({\n    width: 900, height: 700,\n    webPreferences: { nodeIntegration: true, contextIsolation: false }\n  });\n\n  mainWindow.loadFile(path.join(__dirname, 'index.html'));\n\n  try {\n    vm = new VM(bytecode.consts, bytecode.code, { baseDir: __dirname });\n\n    vm.onGuiRender = (payload) => {\n      try { mainWindow.webContents.send('render', payload); } catch (e) {}\n    };\n\n    ipcMain.on('event', (e, id, ev, arg) => { try { if (vm && typeof vm.__dispatchEvent === 'function') vm.__dispatchEvent(id, ev, arg); } catch (ex) { console.error('ipc event dispatch error', ex); } });\n    ipcMain.on('mouse', (e, id, ev, x, y) => { try { if (vm && typeof vm.__dispatchEvent === 'function') vm.__dispatchEvent(id, ev, x, y); } catch (ex) { console.error('ipc mouse dispatch error', ex); } });\n    ipcMain.on('key', (e, type, key, canon) => { try { const k = (canon && canon !== '') ? canon : key; if (vm && typeof vm.__dispatchGlobalKey === 'function') vm.__dispatchGlobalKey(type, k); } catch (ex) { console.error('ipc key dispatch error', ex); } });\n\n  } catch (e) {\n    console.error('Failed to construct VM:', e);\n  }\n\n  mainWindow.webContents.once('did-finish-load', () => {\n    console.log('Renderer finished loading — starting VM');\n    (async () => {\n      try {\n        if (vm) await vm.run();\n      } catch (err) { console.error('VM run error', err); }\n    })();\n  });\n}\n\napp.whenReady().then(createWindow);\napp.on('window-all-closed', () => { app.quit(); });\n`;
  fs.writeFileSync(path.join(buildDir, 'main.js'), mainJs, 'utf8');

  const packageJson = {
    name: outName,
    version: '0.1.0',
    main: 'main.js',
    scripts: {},
    build: {
      appId: 'org.vexon.app',
      asar: false,
      files: ['**/*'],
      win: { target: ['portable','nsis'] },
      directories: { output: 'dist' }
    }
  };
  fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf8');

  console.log('📦 Building Electron app in:', buildDir);
  try {
    child_process.execSync('npx electron-builder --win portable', { cwd: buildDir, stdio: 'inherit' });
    console.log('🎉 EXE created in build/dist (check the dist folder inside .vexon-build)');
  } catch (e) {
    console.error('❌ electron-builder failed. Ensure electron and electron-builder are installed as devDependencies.');
    if (e && e.message) console.error(e.message);
    try { if (e && e.stderr) console.error(String(e.stderr)); } catch (er) {}
    try { if (e && e.stdout) console.error(String(e.stdout)); } catch (er) {}
    console.error("Tip: run 'npx electron-builder --dir' in the .vexon-build folder to create an unpacked app for debugging.");
  }
}

// ---------- Electron runtime mode (executed when Electron spawns this script with --vexon-electron file) ----------
async function runElectronRuntime(filePath) {
  const electron = require('electron');
  const { app, BrowserWindow, ipcMain } = electron;

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error('❌ File not found (Electron runtime):', absPath);
    process.exit(1);
  }

  // Inline renderer HTML for run mode (so run <file> works without writing out files)
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:#fff;font-family:Segoe UI,Arial,Helvetica,sans-serif;"><div id="root" style="padding:10px;"></div><script>(function(){const { ipcRenderer } = require('electron');let WIDGETS = {};ipcRenderer.on('render', (e, payload) => {WIDGETS = payload.widgets || {};const root = document.getElementById('root');if (!root) return;root.innerHTML = '';if (!payload.ui || !payload.ui.children) return;renderNode(payload.ui.children, root);});function renderNode(ids, parent) {for (const id of ids) {const w = WIDGETS[id];if (!w) continue;if (w.type === 'button') {const b = document.createElement('button');b.textContent = w.text || '';if (w.style) Object.assign(b.style, w.style);b.onclick = () => ipcRenderer.send('event', id, 'click');parent.appendChild(b);} else if (w.type === 'label') {const d = document.createElement('div');d.textContent = w.text || '';if (w.style) Object.assign(d.style, w.style);parent.appendChild(d);} else if (w.type === 'textbox') {const i = document.createElement('input');i.value = w.value || '';if (w.style) Object.assign(i.style, w.style);i.oninput = () => ipcRenderer.send('event', id, 'change', i.value);parent.appendChild(i);} else if (w.type === 'vbox' || w.type === 'hbox') {const box = document.createElement('div');box.style.display = 'flex';box.style.flexDirection = (w.type === 'vbox') ? 'column' : 'row';if (w.style) Object.assign(box.style, w.style);parent.appendChild(box);renderNode(w.children || [], box);} else if (w.type === 'canvas') {const c = document.createElement('canvas');c.width = w.width || 300; c.height = w.height || 150; c.style.border = '1px solid #222'; if (w.style) Object.assign(c.style, w.style); parent.appendChild(c); const ctx = c.getContext('2d'); if (w.ops && w.ops.length) { for (const op of w.ops) { if (op[0] === 'rect') { ctx.fillStyle = op[5] || 'black'; ctx.fillRect(op[1], op[2], op[3], op[4]); } else if (op[0] === 'circle') { ctx.fillStyle = op[4] || 'black'; ctx.beginPath(); ctx.arc(op[1], op[2], op[3], 0, Math.PI*2); ctx.fill(); } else if (op[0] === 'text') { ctx.fillStyle = op[4] || 'black'; ctx.fillText(op[3], op[1], op[2]); } else if (op[0] === 'image') { const imgId = String(op[1]); if (!window.__IMG_CACHE) window.__IMG_CACHE = {}; const meta = WIDGETS[imgId]; if (!meta) continue; if (!window.__IMG_CACHE[imgId]) { const im = new Image(); im.src = meta.path; window.__IMG_CACHE[imgId] = im; im.onload = () => { ipcRenderer.send('frame'); }; } const im = window.__IMG_CACHE[imgId]; if (im && im.complete) { if (op[4] == null) ctx.drawImage(im, op[2], op[3]); else ctx.drawImage(im, op[2], op[3], op[4], op[5]); } } else if (op[0] === 'line') { ctx.strokeStyle = op[5] || 'black'; ctx.lineWidth = op[6] || 1; ctx.beginPath(); ctx.moveTo(op[1], op[2]); ctx.lineTo(op[3], op[4]); ctx.stroke(); } else if (op[0] === 'triangle') { ctx.fillStyle = op[7] || 'black'; ctx.beginPath(); ctx.moveTo(op[1], op[2]); ctx.lineTo(op[3], op[4]); ctx.lineTo(op[5], op[6]); ctx.closePath(); ctx.fill(); } else if (op[0] === 'arc') { ctx.fillStyle = op[6] || 'black'; ctx.beginPath(); ctx.arc(op[1], op[2], op[3], op[4], op[5]); ctx.fill(); } else if (op[0] === 'clearRect') { ctx.clearRect(op[1], op[2], op[3], op[4]); } } } c.onmousedown = e => ipcRenderer.send('mouse', id, 'mousedown', e.offsetX, e.offsetY); c.onmousemove = e => ipcRenderer.send('mouse', id, 'mousemove', e.offsetX, e.offsetY); c.onmouseup = e => ipcRenderer.send('mouse', id, 'mouseup', e.offsetX, e.offsetY); } } } function applyStyle(el, style) { for (const k of Object.keys(style)) { try { el.style[k] = style[k]; } catch (e) {} } } ipcRenderer.on('frame', () => {}); window.addEventListener('keydown', (e) => { try { const raw = e.key; const canon = (raw && raw.toLowerCase) ? raw.toLowerCase() : String(raw || '').toLowerCase(); ipcRenderer.send('key', 'keydown', raw, canon); } catch (err) {} }); window.addEventListener('keyup', (e) => { try { const raw = e.key; const canon = (raw && raw.toLowerCase) ? raw.toLowerCase() : String(raw || '').toLowerCase(); ipcRenderer.send('key', 'keyup', raw, canon); } catch (err) {} });</script></body></html>`;

  app.whenReady().then(() => {
    const mainWindow = new BrowserWindow({
      width: 900, height: 700,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    mainWindow.loadURL('data:text/html,' + encodeURIComponent(html));

    try {
      const src = fs.readFileSync(absPath, 'utf8');
      const lexer = new Lexer(src);
      const tokens = lexer.lex();
      const parser = new Parser(tokens, src);
      const stmts = parser.parseProgram();
      const compiler = new Compiler();
      const compiled = compiler.compile(stmts);

      const vm = new VM(compiled.consts, compiled.code, { baseDir: path.dirname(absPath) });

      // When VM serializes UI, forward to renderer
      vm.onGuiRender = (payload) => {
        try { mainWindow.webContents.send('render', payload); } catch (e) {}
      };

      // Wire renderer events to VM
      ipcMain.on('event', (e, id, ev, arg) => {
        try { if (vm && typeof vm.__dispatchEvent === 'function') vm.__dispatchEvent(id, ev, arg); } catch (ex) { console.error('ipc event dispatch error', ex); }
      });
      ipcMain.on('mouse', (e, id, ev, x, y) => {
        try { if (vm && typeof vm.__dispatchEvent === 'function') vm.__dispatchEvent(id, ev, x, y); } catch (ex) { console.error('ipc mouse dispatch error', ex); }
      });
      ipcMain.on('key', (e, type, key, canon) => {
        try { const k = (canon && canon !== '') ? canon : key; if (vm && typeof vm.__dispatchGlobalKey === 'function') vm.__dispatchGlobalKey(type, k); } catch (ex) { console.error('ipc key dispatch error', ex); }
      });

      // Start VM only after renderer signals it's ready
      mainWindow.webContents.once('did-finish-load', () => {
        (async () => {
          try {
            await vm.run();
          } catch (err) {
            console.error('VM run error:', err);
          }
        })();
      });

    } catch (e) {
      console.error('❌ Failed to start VM in Electron runtime:', e && e.stack ? e.stack : e);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

// ---------------- CLI handler ----------------
const args = process.argv.slice(2);
const cmd = args[0];
const fileArg = args[1];
const debug = args.includes('--debug');

(async () => {
  switch (cmd) {
    case 'run':
      if (!fileArg) { console.error("❌ No file specified for 'run'"); process.exit(1); }
      await runFile(fileArg, { debug });
      break;

    case 'compile':
      if (!fileArg) { console.error("❌ No file specified for 'compile'"); process.exit(1); }
      compileToExe(fileArg, { debug });
      break;

    default:
      console.log('Vexon Language CLI');
      console.log('------------------');
      console.log('Run a program:');
      console.log("   node vexon_cli.js run <file.vx> [--debug]");
      console.log('');
      console.log('Compile to EXE:');
      console.log("   node vexon_cli.js compile <file.vx> [--debug]");
      break;
  }
})();
