import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const temp = mkdtempSync(join(tmpdir(), "quotahold-package-"));
mkdirSync("dist", { recursive: true });
function run(command, args, options = {}) {
  const child = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout;
}
try {
  const npm = process.env.npm_execpath;
  assert.ok(npm, "Run this check through npm run verify:package");
  const packed = JSON.parse(
    run(process.execPath, [
      npm,
      "pack",
      "--json",
      "--pack-destination",
      "dist",
      "--cache",
      join(temp, "cache"),
    ]),
  )[0];
  const archive = resolve("dist", packed.filename);
  assert.equal(
    packed.files.some((f) => f.path.includes("node_modules")),
    false,
  );
  const metadata = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
  run(process.execPath, [
    npm,
    "install",
    "--prefix",
    temp,
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "--cache",
    join(temp, "cache"),
    archive,
  ]);
  const check = join(temp, "smoke.mjs");
  writeFileSync(
    check,
    `import {Ledger,runCall} from 'quotahold';import assert from 'node:assert/strict';const ledger=Ledger.create('./smoke.db');try {ledger.configure('demo',{capacity:100,periodSeconds:60,maxInflight:2,unit:'units'});const result=await runCall(ledger,'demo',{key:'k',fingerprint:'a'.repeat(64),estimate:40},async()=>({value:'ok',actual:25,receipt:'r1'}));assert.equal(result.value,'ok');assert.equal(ledger.status('demo').spent,25);}finally{ledger.close();}console.log('Installed package smoke check passed');`,
  );
  console.log(run(process.execPath, [check], { cwd: temp }).trim());
  console.log(
    run(
      process.execPath,
      [join(temp, "node_modules/quotahold/examples/http-worker.js")],
      { cwd: temp },
    ).trim(),
  );
  console.log(
    run(
      process.execPath,
      [join(temp, "node_modules/quotahold/src/cli.js"), "--version"],
      { cwd: temp },
    ).trim(),
  );
  console.log(
    `Verified ${packed.filename}: ${packed.entryCount} files, zero runtime dependencies`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
