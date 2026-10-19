# Integration guide

## Choose a unit and a scope

Use an integer unit your application can estimate and reconcile. If counting total tokens, ensure the estimate includes the input and an enforced maximum output allowance, plus any provider-specific usage that you intend to count. QuotaHold supplies no tokenizer, price table or provider SDK. A declared estimate is not itself an upstream generation limit.

Derive scope from trusted application configuration or authenticated tenant context. A scope is not an access-control boundary. Give every worker the same local database path. This version is intended for a small number of cooperating local processes; it has no server, Redis adapter or cross-host coordinator.

Initialize once with `Ledger.create`, then reopen with `new Ledger(path)` in each process or worker thread. Connections must remain open for the duration of guarded calls. The SQLite operations are synchronous, including lock waits. Avoid sharing the same connection across asynchronous application transaction boundaries; the library commits its own short transaction before running your network callback.

Policies are immutable to avoid silently reinterpreting existing usage. Use a fresh scope for a changed policy, and deliberately manage any overlap with outstanding old-scope work in your application.

## A guarded call

`runCall` reserves units and a slot, commits a single start permission, calls your callback once, and settles the returned `{value, actual, receipt}`. It returns `{value, reservation}`. It never retries or caches application results.

- `DENIED_UNITS` / `DENIED_CONCURRENCY`: no callback ran. Queue, reject or retry later using your application's scheduling policy.
- `REPLAY`: a reservation already exists. Recover its recorded state and your cached business result. Do not automatically create another request key for the same external operation.
- Callback or settlement failure after start: the helper marks the reservation uncertain if SQLite is available, then rethrows. If marking it also fails, an `AggregateError` includes both failures; the committed started hold remains counted.
- A process kill can occur after start but before the callback begins. That call still needs investigation because another process cannot distinguish that boundary from a completed call whose response was lost.

Provider SDKs may retry internally. Disable or account for those retries according to your provider's semantics. QuotaHold does not intercept their network traffic or guarantee exactly-once external execution.

## Low-level flow

```js
const result = ledger.reserve(scope, {
  key: stableRequestKey,
  fingerprint: deterministicPayloadHash,
  estimate: maximumExpectedUnits,
  ttlSeconds: 30,
});
if (result.kind !== 'reserved') {
  // Handle denial or recovery of a replay in your application.
  return result;
}
const hold = ledger.start(scope, result.reservation.id);
// Only after this returns successfully may this worker make its call.
try {
  const response = await callProvider();
  ledger.settle(scope, hold.id, {
    actual: response.units,
    receipt: response.id,
  });
} catch (error) {
  ledger.uncertain(scope, hold.id);
  throw error;
}
```

Use `runCall` when possible; it also handles failure to record uncertainty. Fingerprint a deterministic representation of the actual request, including model/configuration and fields that influence usage. Store the business result in your own durable store. Reusing an ID for a different payload must produce a different fingerprint and a conflict.

## Recovery operations

List both `started` and `uncertain` holds, using pagination. Investigate old started calls even if no worker marked them uncertain. Confirm the outcome using provider receipts and application records. Settle actual usage with a receipt and a short note; settle zero only when zero usage is confirmed. Started calls cannot be cancelled, and extending a TTL cannot free them.

Receipt IDs are bounded identifiers. If your provider uses other characters, derive a stable identifier such as a SHA256 digest and retain the original receipt in your application records. Never put API keys, prompts or sensitive user content in notes or request keys.

## Command-line workflow

After installing the release tarball:

```sh
npx --no-install quotahold init usage.db
npx --no-install quotahold configure usage.db --scope assistant --input node_modules/quotahold/examples/policy.json
npx --no-install quotahold reserve usage.db --scope assistant --input node_modules/quotahold/examples/reservation.json
```

Read the JSON `kind`. For a new reservation, use its `reservation.id`:

```sh
npx --no-install quotahold start usage.db --scope assistant --id RESERVATION_ID
# Run the external task only after start succeeds.
npx --no-install quotahold settle usage.db --scope assistant --id RESERVATION_ID --input node_modules/quotahold/examples/receipt.json
```

For a missing response, mark `uncertain` instead of cancelling. Add a `note` to the settlement JSON after investigating. `status`, `list` and `events` expire unused holds and update the durable clock check, so these commands need write access. CLI JSON input files are trusted local configuration, not a public request ingestion format.

## Playground and verification

The public playground uses the exact `decide` and `availability` functions imported by the SDK. Its lifecycle state lives in browser memory. Parity tests compare a recovery/rollover sequence with the SQLite SDK. It illustrates the accounting policy; it does not simulate cross-process locking, persist data, call providers or measure performance.

The working HTTP example makes two requests to a temporary loopback server, blocks a replay before a third request, retains an injected lost-response reservation, and reconciles it from the server receipt. The fault is deliberately injected after the server responds. Multi-process tests separately verify quota races, duplicate keys, single-start permissions, process exit and lock failures.
