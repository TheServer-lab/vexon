#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const { Lexer, Parser, Compiler, VM } = require("./vexon_core.js");

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
    const lexer = new Lexer(src);
    const tokens = lexer.lex();

    // pass source into Parser so error messages can show context
    const parser = new Parser(tokens, src);
    const stmts = parser.parseProgram();

    const compiler = new Compiler();
    const { consts, code } = compiler.compile(stmts);

    const vm = new VM(consts, code, { baseDir: path.dirname(absPath), debug: !!options.debug });
    await vm.run();
  } catch (err) {
    console.error("❌ Vexon Error:", err && err.message ? err.message : String(err));
    if (err && err.stack) console.error(err.stack);
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

  let consts, code;
  try {
    const lexer = new Lexer(src);
    const tokens = lexer.lex();

    // pass src into Parser so compile errors show context
    const parser = new Parser(tokens, src);
    const stmts = parser.parseProgram();

    const compiler = new Compiler();
    const compiled = compiler.compile(stmts);
    consts = compiled.consts;
    code = compiled.code;

    console.log("✓ Compiled Vexon bytecode.");
  } catch (err) {
    console.error("❌ Compile error:", err && err.message ? err.message : String(err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }

  // -------------------------
  // Generate JS runner
  // -------------------------
  const outJs = absPath.replace(/\.vx$/, "_build.js");
  const jsRunner = `#!/usr/bin/env node
"use strict";
const { VM } = require("./vexon_core.js");

const consts = ${JSON.stringify(consts, null, 2)};
const code = ${JSON.stringify(code, null, 2)};

(async () => {
  const vm = new VM(consts, code, { baseDir: __dirname, debug: ${options.debug ? "true" : "false"} });
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

  // -------------------------
  // Build EXE with pkg
  // -------------------------
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
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

// -----------------------------
// CLI HANDLER
// -----------------------------
const args = process.argv.slice(2);
const cmd = args[0];
const fileArg = args[1];
const debug = args.includes("--debug");

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
