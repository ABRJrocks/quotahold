import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "quotahold-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "ledger.db");
  return {
    root,
    path,
    run(...args) {
      return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    },
    input(value) {
      const p = join(root, "input.json");
      writeFileSync(p, JSON.stringify(value));
      return p;
    },
  };
}
test("CLI configures, admits, starts, settles and inspects a call", (t) => {
  const f = fixture(t);
  assert.equal(f.run("init", f.path).status, 0);
  const args = [f.path, "--scope", "team"];
  assert.equal(
    f.run(
      "configure",
      ...args,
      "--input",
      f.input({
        capacity: 100,
        periodSeconds: 60,
        maxInflight: 2,
        unit: "tokens",
      }),
    ).status,
    0,
  );
  const result = f.run(
    "reserve",
    ...args,
    "--input",
    f.input({ key: "one", fingerprint: "a".repeat(64), estimate: 50 }),
  );
  assert.equal(result.status, 0);
  const id = JSON.parse(result.stdout).reservation.id;
  assert.equal(f.run("start", ...args, "--id", id).status, 0);
  assert.equal(
    f.run(
      "settle",
      ...args,
      "--id",
      id,
      "--input",
      f.input({ actual: 30, receipt: "r1" }),
    ).status,
    0,
  );
  assert.equal(JSON.parse(f.run("status", ...args).stdout).spent, 30);
  assert.equal(
    JSON.parse(f.run("events", ...args).stdout).at(-1).kind,
    "settled",
  );
});
test("CLI denies with exit code 3 and never prints invalid private input", (t) => {
  const f = fixture(t);
  f.run("init", f.path);
  const args = [f.path, "--scope", "team"];
  f.run(
    "configure",
    ...args,
    "--input",
    f.input({
      capacity: 10,
      periodSeconds: 60,
      maxInflight: 1,
      unit: "tokens",
    }),
  );
  assert.equal(
    f.run(
      "reserve",
      ...args,
      "--input",
      f.input({ key: "one", fingerprint: "a".repeat(64), estimate: 20 }),
    ).status,
    3,
  );
  const bad = f.input({
    key: "one",
    fingerprint: "private-secret-value",
    estimate: 5,
  });
  const result = f.run("reserve", ...args, "--input", bad);
  assert.equal(result.status, 2);
  assert.ok(!result.stderr.includes("private-secret-value"));
  const missing = join(f.root, "missing.db");
  assert.equal(f.run("status", missing, "--scope", "team").status, 2);
  assert.equal(existsSync(missing), false);
});
test("CLI bounds input bytes and rejects unknown options", (t) => {
  const f = fixture(t);
  f.run("init", f.path);
  const input = join(f.root, "large.json");
  writeFileSync(input, " ".repeat(16385));
  assert.equal(
    f.run("configure", f.path, "--scope", "x", "--input", input).status,
    2,
  );
  assert.equal(f.run("--unknown").status, 2);
  assert.equal(f.run("--version").stdout.trim(), "0.1.0");
});
