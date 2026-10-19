import {
  availability,
  decide,
  identifier,
  integer,
  requireValue,
  validatePolicy,
  windowStart,
} from "../src/policy.js";

/** In-memory policy rehearsal. Not a durable ledger or provider connection. */
export class Simulation {
  constructor(
    policy = {
      capacity: 240,
      periodSeconds: 60,
      maxInflight: 3,
      unit: "units",
    },
  ) {
    this.policy = validatePolicy(policy);
    this.now = 0;
    this.holds = [];
    this.history = [];
    this.counter = 0;
    this.log("Session started. Reserve allowance, then start a call.");
  }
  log(message) {
    this.history.unshift({ at: this.now, message });
    this.history = this.history.slice(0, 50);
  }
  expire() {
    for (const h of this.holds)
      if (h.state === "reserved" && h.expiresAt <= this.now) {
        h.state = "expired";
        this.log(
          `${h.key}: unused start deadline elapsed. ${h.estimate} units released.`,
        );
      }
  }
  usage() {
    this.expire();
    const period = windowStart(this.now, this.policy.periodSeconds);
    return availability(this.policy, {
      spent: this.holds
        .filter((h) => h.state === "settled" && h.windowStart === period)
        .reduce((n, h) => n + h.actual, 0),
      held: this.holds
        .filter((h) => ["reserved", "started", "uncertain"].includes(h.state))
        .reduce((n, h) => n + h.estimate, 0),
      inflight: this.holds.filter((h) =>
        ["reserved", "started", "uncertain"].includes(h.state),
      ).length,
    });
  }
  reserve(key, estimate) {
    identifier(key, "Request key");
    integer(estimate, "Estimated units", 1);
    this.expire();
    const found = this.holds.find((h) => h.key === key);
    if (found) {
      requireValue(
        found.estimate === estimate,
        "CONFLICT",
        "Request key has a different estimate",
      );
      this.log(`${key}: replay blocked. No new allowance reserved.`);
      return { kind: "replay" };
    }
    requireValue(
      this.holds.length < 100,
      "INPUT",
      "Rehearsal limit reached. Reset the session to continue.",
    );
    const check = decide(this.policy, this.usage(), estimate);
    if (!check.allowed) {
      this.log(`${key}: denied by ${check.reason}.`);
      return { kind: "denied", reason: check.reason };
    }
    this.holds.push({
      id: ++this.counter,
      key,
      estimate,
      state: "reserved",
      actual: null,
      windowStart: windowStart(this.now, this.policy.periodSeconds),
      expiresAt: this.now + 30,
    });
    this.log(`${key}: ${estimate} units reserved. Start within 30 seconds.`);
    return { kind: "reserved" };
  }
  act(id, action, actual = 0) {
    this.expire();
    const h = this.holds.find((h) => h.id === id);
    requireValue(h, "NOT_FOUND", "Select an existing call");
    if (action === "start") {
      requireValue(
        h.state === "reserved",
        "STATE",
        "Only a reserved call can start",
      );
      h.state = "started";
      this.log(`${h.key}: started. Its allowance stays held until settlement.`);
    } else if (action === "uncertain") {
      requireValue(
        h.state === "started",
        "STATE",
        "Only a started call can lose its response",
      );
      h.state = "uncertain";
      this.log(
        `${h.key}: response lost. ${h.estimate} units and one slot remain held.`,
      );
    } else if (action === "cancel") {
      requireValue(
        h.state === "reserved",
        "STATE",
        "Only an unstarted call can be cancelled",
      );
      h.state = "cancelled";
      this.log(`${h.key}: cancelled before starting.`);
    } else if (action === "settle") {
      integer(actual, "Actual units");
      requireValue(
        h.state === "started" || h.state === "uncertain",
        "STATE",
        "Only started or uncertain calls can settle",
      );
      h.state = "settled";
      h.actual = actual;
      this.log(
        `${h.key}: reconciled at ${actual} units in its original admission window.`,
      );
    } else throw new Error("Unknown action");
  }
  advance(seconds) {
    integer(seconds, "Advance seconds", 1, 2678400);
    this.now += seconds;
    this.expire();
    this.log(
      `Clock advanced by ${seconds}s. Started and uncertain calls keep their holds.`,
    );
  }
}
