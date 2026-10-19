import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as sqlite from "node:sqlite";
import { Ledger } from "../src/index.js";
const Database = sqlite.Database ?? sqlite.DatabaseSync;
const worker = fileURLToPath(new URL("./contender.js", import.meta.url));
function run(path, op, key, exit = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, path, op, key], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    child.stdout.on("data", (data) => (out += data));
    child.stderr.on("data", (data) => (err += data));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === exit
        ? resolve(out.trim())
        : reject(new Error(`Worker exited ${code}: ${err}`)),
    );
  });
}
function fixture(t, policy) {
  const root = mkdtempSync(join(tmpdir(), "quotahold-race-"));
  const path = join(root, "ledger.db");
  const ledger = Ledger.create(path, { clock: () => 120 });
  ledger.configure("team", policy);
  t.after(() => {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { ledger, path };
}
test("competing processes cannot over-admit allowance", async (t) => {
  const f = fixture(t, {
    capacity: 100,
    periodSeconds: 60,
    maxInflight: 20,
    unit: "tokens",
  });
  const results = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      run(f.path, "reserve", `job-${i}`).then(JSON.parse),
    ),
  );
  assert.equal(results.filter((r) => r.kind === "reserved").length, 5);
  assert.equal(f.ledger.status("team").held, 100);
});
test("competing processes cannot over-admit concurrency slots", async (t) => {
  const f = fixture(t, {
    capacity: 1000,
    periodSeconds: 60,
    maxInflight: 3,
    unit: "tokens",
  });
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      run(f.path, "reserve", `job-${i}`).then(JSON.parse),
    ),
  );
  assert.equal(results.filter((r) => r.kind === "reserved").length, 3);
  assert.equal(f.ledger.status("team").inflight, 3);
});
test("the same request key yields one reservation across workers", async (t) => {
  const f = fixture(t, {
    capacity: 1000,
    periodSeconds: 60,
    maxInflight: 20,
    unit: "tokens",
  });
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      run(f.path, "reserve", "same-key").then(JSON.parse),
    ),
  );
  assert.equal(results.filter((r) => r.kind === "reserved").length, 1);
  assert.equal(new Set(results.map((r) => r.reservation.id)).size, 1);
  const id = results[0].reservation.id;
  const starts = await Promise.all(
    Array.from({ length: 10 }, () => run(f.path, "start", id)),
  );
  assert.equal(starts.filter((s) => s === "started").length, 1);
});
test("abrupt worker exit leaves its started allowance durable", async (t) => {
  const f = fixture(t, {
    capacity: 100,
    periodSeconds: 60,
    maxInflight: 3,
    unit: "tokens",
  });
  const h = f.ledger.reserve("team", {
    key: "crash",
    fingerprint: "a".repeat(64),
    estimate: 80,
  }).reservation;
  await run(f.path, "crash", h.id, 17);
  assert.equal(f.ledger.status("team").held, 80);
  assert.equal(f.ledger.list("team")[0].state, "started");
});
test("event-write failure rolls back a reservation and its accounting", (t) => {
  const f = fixture(t, {
    capacity: 100,
    periodSeconds: 60,
    maxInflight: 3,
    unit: "tokens",
  });
  const db = new Database(f.path);
  try {
    db.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON events WHEN NEW.kind='reserved' BEGIN SELECT RAISE(ABORT,'injected'); END",
    );
  } finally {
    db.close();
  }
  assert.throws(() =>
    f.ledger.reserve("team", {
      key: "fail",
      fingerprint: "a".repeat(64),
      estimate: 20,
    }),
  );
  assert.equal(f.ledger.status("team").held, 0);
  assert.equal(f.ledger.list("team").length, 0);
});
test("a busy database rejects admission without an in-memory fallback", async (t) => {
  const f = fixture(t, {
    capacity: 100,
    periodSeconds: 60,
    maxInflight: 3,
    unit: "tokens",
  });
  const blocker = new Database(f.path);
  blocker.exec("BEGIN EXCLUSIVE");
  try {
    await assert.rejects(run(f.path, "reserve", "blocked"), /Worker exited/);
  } finally {
    blocker.exec("ROLLBACK");
    blocker.close();
  }
  assert.equal(f.ledger.status("team").held, 0);
  assert.equal(f.ledger.list("team").length, 0);
});
