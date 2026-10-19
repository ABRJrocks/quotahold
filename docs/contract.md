# Accounting and lifecycle contract

## Admission arithmetic

For the current fixed window:

```text
spent = actual units settled against this admission window
held = estimates of every reserved, started and uncertain call, across all windows
available = max(0, capacity - spent - held)
slots = max(0, maxInflight - active reservation count)
```

A new call is admitted only when its estimate fits `available` and at least one slot exists. Reserved calls consume slots before they start. When both constraints fail, the reported reason is concurrency. Units, estimates and actual usage are integers. No currency conversion or token counting occurs.

Admission, clock validation, expiration, state transition and event insertion execute in one `BEGIN IMMEDIATE` transaction. Competing writers serialize. SQLite lock or commit errors roll back the operation and propagate to the caller. There is no admission path outside SQLite.

## Start and recovery

| State | Holds units and a slot | Allowed transitions |
| --- | --- | --- |
| reserved | Yes | started, cancelled, expired |
| started | Yes | settled, uncertain |
| uncertain | Yes | settled |
| settled | No; actual units count in original window | Identical settlement replay only |
| cancelled | No | Identical cancellation replay only |
| expired | No | None |

`start` returns successfully once. A retry after that returns a state error, even if the first worker crashed before making the network call. This tradeoff avoids issuing another start permission when execution is ambiguous; it does not implement exactly-once external side effects.

A reserved hold expires at `expiresAt <= now`. Expiration is lazy maintenance on operations for that scope. Started and uncertain calls do not expire. `uncertain` may be repeated without another event. `cancel` may be repeated after cancellation. A worker crash leaves its started state durable; no background process labels it automatically.

Settlement requires a nonnegative actual count and receipt. A receipt may belong to only one reservation within a scope. An identical settlement may be repeated; changes to actual count, receipt or note conflict. Uncertain-call settlement additionally requires a nonblank recovery note. Zero actual usage is an explicit operator/application assertion, not verified by the library.

If actual usage exceeds the estimate, it is recorded in full with an `underestimated` event reason. It may exceed the configured capacity and deny subsequent admissions. The library cannot stop a provider from consuming more than the supplied estimate.

## Fixed windows and unknown work

`windowStart = floor(now / periodSeconds) * periodSeconds`, using Unix seconds. These are not calendar months, rolling windows or provider billing cycles. Settlement stays assigned to the original reservation window, even when it completes later.

An unresolved call from an old window still holds estimated units and a slot in the new window. On settlement, its estimate is released from the current availability calculation and its actual usage is charged to its original window. This is a reservation-accounting policy, not evidence of when the provider billed the work.

Every committed operation records a nondecreasing clock value in the database. A backward host clock fails closed. Custom clocks are for trusted integration/testing; never derive them from an untrusted request.

## Idempotency and privacy

A request key is unique within its scope for the lifetime of the ledger. Repeating it with the same fingerprint, estimate and TTL returns `kind: replay`, including after terminal states or period changes. It does not reset the deadline or authorize a new external call. Changing any of those inputs conflicts. A previously denied key may be retried because no reservation was created.

Fingerprints are lowercase SHA256 hex digests supplied by the caller. Include every request field that matters to identity and usage. QuotaHold does not recompute or validate the relationship between a digest and a provider payload. Hashes of predictable private content may still reveal information through guessing; keep sensitive payloads out of the ledger.

The ledger stores identifiers, estimates, actual usage, timestamps, fingerprints, notes and events. It stores neither provider responses nor application results. It has no authentication, encryption, tamper-proof audit chain or multi-host coordination.

## Bounds and storage

| Input | Bound |
| --- | --- |
| Policy capacity / estimate / actual | At most 1,000,000,000 units; capacity and estimate at least 1 |
| Concurrency | 1 to 1,000 active holds |
| Period | 60 to 2,678,400 seconds |
| Start TTL | 1 to 3,600 seconds, default 60 |
| Scope / key / receipt / unit | 1 to 128 ASCII identifier characters: letters, digits, `_`, `.`, `:`, `-`; begins alphanumeric |
| Fingerprint | 64 lowercase hexadecimal characters |
| Recovery note | Up to 256 characters, no control characters |
| CLI JSON file | 16 KiB, trusted flat object |
| List or event page | 1 to 1,000 entries, default 100 |

Reservation lists use an exclusive UUID cursor ordered lexically. Event lists use an exclusive increasing sequence cursor. Paginate until a short page. Lists are not a frozen snapshot across concurrent writes; newly inserted IDs before a reservation cursor may require another scan. Prefer the event feed for incremental monitoring.

Schema version 1 uses Node's built-in SQLite and DELETE journaling with synchronous FULL. Creation refuses to overwrite files and requests mode 0600 where supported. Database storage remains plaintext. All database files and containing directories must be trusted and local. Keep consistent backups; manually editing rows or copying live database files can invalidate accounting. No retention pruning or schema migration is implemented in this release.
