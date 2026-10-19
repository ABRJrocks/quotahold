import { Ledger, runCall, decide, type Policy } from "quotahold";
const policy: Policy = {
  capacity: 100,
  periodSeconds: 60,
  maxInflight: 2,
  unit: "tokens",
};
const ledger = new Ledger("test.db");
ledger.configure("scope", policy);
const result = ledger.reserve("scope", {
  key: "k",
  fingerprint: "a".repeat(64),
  estimate: 10,
});
if (result.kind !== "denied") ledger.start("scope", result.reservation.id);
else {
  const reason: "units" | "concurrency" = result.reason;
  void reason;
}
const wrapped = await runCall(
  ledger,
  "scope",
  { key: "k2", fingerprint: "b".repeat(64), estimate: 10 },
  async () => ({ value: { answer: "ok" }, actual: 5, receipt: "r1" }),
);
const answer: string = wrapped.value.answer;
void answer;
// @ts-expect-error reservation input must be an object
ledger.reserve("scope", "invalid");
const incomplete = async () => ({ value: "ok", actual: 2 });
const input = { key: "bad", fingerprint: "a".repeat(64), estimate: 10 };
// @ts-expect-error call results need usage receipts
await runCall(ledger, "scope", input, incomplete);
decide(policy, { spent: 0, held: 10, inflight: 1 }, 20);
