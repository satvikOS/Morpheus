"use strict";
// Generate only reviewed built-in contributions; no paper metadata or user inputs are read.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "lib/unified-model.ts");
const targetPath = path.join(root, "services/signal-gateway/app/unified-contributions.json");
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  process.stderr.write("Usage: node scripts/export-unified-manifest.cjs [--check]\n");
  process.exit(2);
}
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled)(loaded, loaded.exports, require);
loaded.exports.unifiedContributionManifest().then((manifest) => {
  const bytes = JSON.stringify(manifest, null, 2) + "\n";
  if (args[0] === "--check") {
    if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, "utf8") !== bytes) throw new Error("Gateway contribution allowlist is stale. Review graph changes, regenerate the manifest and rerun boundary tests.");
  } else {
    fs.writeFileSync(targetPath + ".tmp", bytes, { mode: 0o644 });
    fs.renameSync(targetPath + ".tmp", targetPath);
  }
  process.stdout.write("Reviewed unified manifest " + manifest.contentSha256 + (args[0] === "--check" ? " matches.\n" : " exported.\n"));
}).catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
