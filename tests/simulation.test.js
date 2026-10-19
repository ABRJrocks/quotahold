import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "../src/index.js";
import { Simulation } from "../web/simulation.js";
test("playground lifecycle agrees with the durable SDK for recovery and rollover", (t) => {
  const root = mkdtempSync(join(tmpdir(), "quotahold-parity-"));
  let now = 0;
  const ledger = Ledger.create(join(root, "ledger.db"), { clock: () => now });
  t.after(() => {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  });
  const sim = new Simulation();
  ledger.configure("team", sim.policy);
  const ids = new Map();
  function reserve(key, estimate) {
    const actual = ledger.reserve("team", {
      key,
      fingerprint: "a".repeat(64),
      estimate,
      ttlSeconds: 30,
    });
    const model = sim.reserve(key, estimate);
    assert.equal(model.kind, actual.kind);
    if (actual.kind === "reserved") ids.set(key, actual.reservation.id);
  }
  function act(key, action, actual = 0) {
    sim.act(sim.holds.find((h) => h.key === key).id, action, actual);
    if (action === "settle")
      ledger.settle("team", ids.get(key), {
        actual,
        receipt: "r-" + key,
        note: "Confirmed for parity rehearsal",
      });
    else ledger[action]("team", ids.get(key));
  }
  function check() {
    const live = ledger.status("team"),
      modeled = sim.usage();
    for (const key of [
      "spent",
      "held",
      "available",
      "inflight",
      "slots",
      "overage",
    ])
      assert.equal(modeled[key], live[key], key);
  }
  reserve("a", 80);
  act("a", "start");
  act("a", "uncertain");
  check();
  now += 60;
  sim.advance(60);
  check();
  reserve("b", 80);
  act("b", "start");
  reserve("c", 80);
  reserve("d", 80);
  check();
  act("a", "settle", 30);
  act("b", "settle", 50);
  check();
  now += 30;
  sim.advance(30);
  check();
});
test("the playground can advance a full day and keeps call keys literal", () => {
  const sim = new Simulation({
    capacity: 100,
    periodSeconds: 86400,
    maxInflight: 2,
    unit: "units",
  });
  sim.reserve("a", 20);
  sim.act(1, "start");
  sim.advance(86400);
  assert.equal(sim.usage().held, 20);
  assert.throws(() => sim.reserve("<script>", 1));
});
