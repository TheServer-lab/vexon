#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const { Lexer, Parser, Compiler, VM } = require("./vexon_core.js");

// -----------------------------
// Helpers
// -----------------------------
function printRuntimeError(err) {
  try {
    if (err && typeof err === "object") {
      if (err.file || err.line) {
        console.error(`❌ Runtime Error: ${err.message}`);
        if (err.file) console.error(`   at ${err.file}:${err.line || "?"}:${err.col || "?"}`);
      } else if (err.stack) {
        console.error(`❌ Runtime Error: ${err.message}`);
        console.error(err.stack);
      } else {
        console.error("❌ Runtime Error:", err);
      }
    } else {
      console.error("❌ Runtime Error:", String(err));
    }
  } catch (e) {
    console.error("❌ Runtime Error:", String(err));
  }
}

// -----------------------------
// RUN VEXON SOURCE (.vx)
// -----------------------------
async function runFile(filePath, options = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error("❌ File not found:", absPath);
    process.exit(1);
  }

  const src = fs.readFileSync(absPath, "utf-8");

  try {
    const lexer = new Lexer(src, absPath);
    const tokens = lexer.lex();

    const parser = new Parser(tokens);
    const stmts = parser.parseProgram();

    const compiler = new Compiler();
    const compiled = compiler.compile(stmts);
    const consts = compiled.consts;
    const code = compiled.code;
    const ipToPos = compiled.ipToPos || new Map();

    const vm = new VM(consts, code, { baseDir: path.dirname(absPath), debug: !!options.debug, ipToPos });
    await vm.run();
  } catch (err) {
    printRuntimeError(err);
    process.exit(1);
  }
}

// -----------------------------
// COMPILE TO EXE
// -----------------------------
function compileToExe(filePath, options = {}) {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    console.error("❌ File not found:", absPath);
    process.exit(1);
  }

  console.log("⚙️ Compiling:", path.basename(absPath));

  const src = fs.readFileSync(absPath, "utf-8");

  let consts, code, ipToPos;
  try {
    const lexer = new Lexer(src, absPath);
    const tokens = lexer.lex();

    const parser = new Parser(tokens);
    const stmts = parser.parseProgram();

    const compiler = new Compiler();
    const compiled = compiler.compile(stmts);
    consts = compiled.consts;
    code = compiled.code;
    ipToPos = compiled.ipToPos || new Map();

    console.log("✓ Compiled Vexon bytecode.");
  } catch (err) {
    console.error("❌ Compile error:", err && err.message ? err.message : String(err));
    return;
  }

  const outJs = absPath.replace(/\.vx$/, "_build.js");
  const ipToPosObj = {};
  if (ipToPos && typeof ipToPos.forEach === "function") {
    ipToPos.forEach((pos, ip) => {
      ipToPosObj[ip] = pos;
    });
  }

  const jsRunner = `#!/usr/bin/env node
"use strict";
const { VM } = require("./vexon_core.js");

const consts = ${JSON.stringify(consts, null, 2)};
const code = ${JSON.stringify(code, null, 2)};
const ipToPos = ${JSON.stringify(ipToPosObj, null, 2)};

function reviveIpToPos(obj) {
  const m = new Map();
  for (const k of Object.keys(obj)) {
    m.set(Number(k), obj[k]);
  }
  return m;
}

(async () => {
  const vm = new VM(consts, code, { baseDir: __dirname, debug: ${options.debug ? "true" : "false"}, ipToPos: reviveIpToPos(ipToPos) });
  try {
    await vm.run();
  } catch (err) {
    try {
      if (err && typeof err === "object") {
        if (err.file || err.line) {
          console.error(\`❌ Vexon Runtime Error: \${err.message}\`);
          if (err.file) console.error(\`   at \${err.file}:\${err.line || "?"}:\${err.col || "?"}\`);
        } else if (err.stack) {
          console.error(\`❌ Vexon Runtime Error: \${err.message}\`);
          console.error(err.stack);
        } else {
          console.error("❌ Vexon Runtime Error:", err);
        }
      } else {
        console.error("❌ Vexon Runtime Error:", String(err));
      }
    } catch (e) {
      console.error("❌ Vexon Runtime Error:", String(err));
    }
    process.exit(1);
  }
})();
`;

  fs.writeFileSync(outJs, jsRunner, "utf8");
  fs.chmodSync(outJs, 0o755);
  console.log("✓ Generated JS runner:", outJs);

  const outExe = absPath.replace(/\.vx$/, ".exe");
  console.log("📦 Creating EXE with pkg (node18-win-x64)...");

  try {
    child_process.execSync(
      `pkg "${outJs}" --targets node18-win-x64 --output "${outExe}"`,
      { stdio: "inherit" }
    );
    console.log("🎉 EXE created:", outExe);
  } catch (err) {
    console.error("❌ Failed to build EXE:", err && err.message ? err.message : String(err));
  }
}

// -----------------------------
// CLI HANDLER
// -----------------------------
const args = process.argv.slice(2);
const cmd = args[0];
const fileArg = args[1];
const debug = args.includes("--debug");
const verbose = args.includes("--verbose");
const failFast = args.includes("--fail-fast");
const listTests = args.includes("--list-tests");
const onlyIdx = args.indexOf("--only");
const onlyName = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

(async () => {
  switch (cmd) {
    case "run":
      if (!fileArg) {
        console.error("❌ No file specified for 'run'");
        process.exit(1);
      }
      await runFile(fileArg, { debug });
      break;

    case "compile":
      if (!fileArg) {
        console.error("❌ No file specified for 'compile'");
        process.exit(1);
      }
      compileToExe(fileArg, { debug });
      break;

    case "test":
      await runSmokeTests({ verbose, failFast, listTests, only: onlyName });
      break;

    default:
      console.log("Vexon Language CLI");
      console.log("------------------");
      console.log("Run a program:");
      console.log("   node vexon_cli.js run <file.vx> [--debug]");
      console.log("");
      console.log("Compile to EXE:");
      console.log("   node vexon_cli.js compile <file.vx> [--debug]");
      console.log("");
      console.log("Run smoke tests:");
      console.log("   node vexon_cli.js test [--verbose] [--fail-fast] [--list-tests] [--only \"Test Name\"]");
      break;
  }
})();

// -----------------------------
// SMOKE TESTS
// -----------------------------
const smokeTestRegistry = [
  { name: "Export/import", description: "Validates default and named exports with live bindings" },
  { name: "Cycle import", description: "Validates cycle-safe loader with partial initialization" }
];

function captureOutput(fn) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => { logs.push(args.join(" ")); };
  const done = () => { console.log = origLog; };
  return Promise.resolve()
    .then(fn)
    .then(() => {
      done();
      return logs;
    })
    .catch(err => {
      done();
      throw err;
    });
}

async function runSmokeTests(opts = {}) {
  console.log("🔍 Running Vexon smoke tests...");

  if (opts.listTests) {
    console.log("\n📋 Available Smoke Tests");
    console.log("------------------------");
    console.table(smokeTestRegistry);
    return;
  }

  const tmpDir = path.join(__dirname, "smoke_tests");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  // Prepare test files
  const mathFile = path.join(tmpDir, "math.vx");
  const mainFile = path.join(tmpDir, "main.vx");
  const aFile = path.join(tmpDir, "a.vx");
  const bFile = path.join(tmpDir, "b.vx");

  fs.writeFileSync(mathFile, `
export let counter = 0;

export fn inc() {
  counter = counter + 1;
}

export default fn square(x) {
  return x * x;
}
`.trim() + "\n", "utf8");

  fs.writeFileSync(mainFile, `
import { counter, inc } from "math.vx";
import "math.vx" as math;

print(counter);   // expect 0
inc();
print(counter);   // expect 1

print(math.default(5)); // expect 25
`.trim() + "\n", "utf8");

  fs.writeFileSync(aFile, `
import { valueB } from "b.vx";
export let valueA = "A-start";

print("In a.vx, valueB =", valueB);
valueA = "A-updated";
`.trim() + "\n", "utf8");

  fs.writeFileSync(bFile, `
import { valueA } from "a.vx";
export let valueB = "B-start";

print("In b.vx, valueA =", valueA);
valueB = "B-updated";
`.trim() + "\n", "utf8");

  const summary = [];
  const shouldRun = (name) => !opts.only || opts.only.toLowerCase() === name.toLowerCase();

  // Test 1: Export/import
  if (shouldRun("Export/import")) {
    const logs1 = await captureOutput(() => runFile(mainFile, { debug: false }));
    if (opts.verbose) {
      console.log("Logs from export/import test:", logs1);
    }
    const expected1 = ["0", "1", "25"];
    const pass1 = JSON.stringify(logs1.slice(0, 3)) === JSON.stringify(expected1);
    summary.push({
      name: "Export/import",
      expected: expected1.join(", "),
      actual: logs1.slice(0, 3).join(", "),
      status: pass1 ? "PASS" : "FAIL"
    });
    if (!pass1) {
      console.error("❌ Export/import test failed. Got:", logs1);
      if (opts.failFast) {
        printSummary(summary, opts.verbose);
        process.exit(1);
      }
    } else {
      console.log("✅ Export/import test passed.");
    }
  }

  // Test 2: Cycle import
  if (shouldRun("Cycle import")) {
    console.log("\n🔄 Cycle import test:");
    const logs2 = await captureOutput(() => runFile(aFile, { debug: false }));
    if (opts.verbose) {
      console.log("Logs from cycle import test:", logs2);
    }
    const pass2 = (logs2.some(l => l.includes("In a.vx, valueB = B-start")) &&
                   logs2.some(l => l.includes("In b.vx, valueA = A-start")));
    summary.push({
      name: "Cycle import",
      expected: "valueB = B-start, valueA = A-start",
      actual: logs2.filter(l => l.includes("value")).join(" | "),
      status: pass2 ? "PASS" : "FAIL"
    });
    if (!pass2) {
      console.error("❌ Cycle import test failed. Got:", logs2);
      if (opts.failFast) {
        printSummary(summary, opts.verbose);
        process.exit(1);
      }
    } else {
      console.log("✅ Cycle import test passed.");
    }
  }

  printSummary(summary, opts.verbose);

  if (summary.some(s => s.status === "FAIL")) process.exit(1);
  console.log("🎉 All smoke tests passed.");
}

function printSummary(summary, verbose) {
  if (verbose) {
    console.log("\n📊 Smoke Test Summary");
    console.log("---------------------");
    console.table(summary);
  }
}
