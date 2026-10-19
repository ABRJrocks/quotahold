/** A real loopback HTTP call with an intentionally lost response. No credentials. */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Ledger, runCall } from "../src/index.js";

export async function httpDemo() {
  let requests = 0;
  const receipts = [];
  const server = createServer((_req, res) => {
    requests++;
    const receipt = `local-${requests}`;
    receipts.push(receipt);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ id: receipt, units: 30, output: "Local test response" }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = mkdtempSync(join(tmpdir(), "quotahold-http-"));
  const ledger = Ledger.create(join(root, "usage.db"));
  try {
    ledger.configure("assistant", {
      capacity: 200,
      periodSeconds: 3600,
      maxInflight: 2,
      unit: "tokens",
    });
    const fingerprint = createHash("sha256")
      .update("public-demo-payload")
      .digest("hex");
    const input = (key) => ({ key, fingerprint, estimate: 80 });
    const call = async () => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}`,
        { signal: AbortSignal.timeout(5000) },
      );
      const body = await response.json();
      return { value: body.output, actual: body.units, receipt: body.id };
    };
    await runCall(ledger, "assistant", input("success"), call);
    await assert.rejects(runCall(ledger, "assistant", input("success"), call), {
      code: "REPLAY",
    });
    await assert.rejects(
      runCall(ledger, "assistant", input("lost-response"), async () => {
        await call();
        throw new Error(
          "Injected response loss after the local server handled the request",
        );
      }),
      /Injected response loss/,
    );
    const before = ledger.status("assistant");
    assert.equal(before.spent, 30);
    assert.equal(before.held, 80);
    assert.equal(before.uncertain, 1);
    await assert.rejects(
      runCall(
        ledger,
        "assistant",
        { ...input("too-large"), estimate: 100 },
        call,
      ),
      { code: "DENIED_UNITS" },
    );
    assert.equal(requests, 2);
    const unknown = ledger
      .list("assistant")
      .find((h) => h.state === "uncertain");
    ledger.settle("assistant", unknown.id, {
      actual: 30,
      receipt: receipts[1],
      note: "Confirmed by the loopback provider receipt",
    });
    const after = ledger.status("assistant");
    assert.equal(after.spent, 60);
    assert.equal(after.held, 0);
    return {
      verified: true,
      httpRequests: requests,
      replayedRequestDidNotCallAgain: true,
      unknownHeldUnits: before.held,
      reconciledUnits: after.spent,
    };
  } finally {
    ledger.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}
if (import.meta.main) console.log(JSON.stringify(await httpDemo(), null, 2));
