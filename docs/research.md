# Research and scope

Concurrent calls must account for in-flight work rather than checking recorded usage alone. [LiteLLM's budget documentation](https://docs.litellm.ai/docs/proxy/users) describes pre-call reservations and explicitly warns that disabling them can allow concurrent requests to exceed a configured budget. LiteLLM is an established gateway with provider routing and broader deployment support. Use it when those features fit your system.

QuotaHold is an embedded alternative for cooperating Node.js workers sharing a local SQLite file. It meters application-defined integer units, not prices. It does not estimate tokens, proxy requests, charge customers or synchronize with a provider invoice. Its distinguishing focus is conservative recovery: a started call does not become free merely because a timeout or process crash makes its outcome unknown.

[SQLite transactions](https://www.sqlite.org/lang_transaction.html) and [isolation](https://www.sqlite.org/isolation.html) provide a single writer and atomic admission under BEGIN IMMEDIATE. A busy database fails the operation rather than admitting work from an in-memory fallback. The ledger uses default DELETE journaling and synchronous FULL writes on a local filesystem. No cross-host or network-filesystem coordination is claimed.

[Node's built-in SQLite API](https://nodejs.org/api/sqlite.html) executes synchronously and supplies the database connection without an npm runtime dependency. QuotaHold requires Node 24.15+ and tests Node 24 and 26. Upstream SQLite API stability can vary between Node releases; the package uses only the basic connection and prepared statement operations.

[Stripe's idempotency documentation](https://docs.stripe.com/api/idempotent_requests) illustrates the importance of stable request keys and conflicting payload checks. QuotaHold's reservation idempotency is local and retained for the life of the ledger. It does not make a provider request idempotent or cache its response.

The estimate is supplied by the application. Underestimation or provider-side retries can still exceed the intended usage allowance. Actual usage above a reservation is recorded honestly rather than clamped. Scope is a trusted application identifier, not authentication. The browser playground uses the same admission arithmetic as the SDK but stores simulated state only in memory; it does not reproduce SQLite concurrency or call a provider.
