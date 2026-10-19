# Changelog

## 0.1.0

Initial release:

- Durable SQLite quota reservations for local cooperating Node.js processes.
- Atomic unit and concurrency admission, stable request keys and fingerprint checks.
- Single start permission, unused-deadline expiry and conservative unknown-outcome recovery.
- Idempotent actual-usage settlement with receipt uniqueness and visible underestimation.
- Fixed-window accounting with outstanding holds retained across rollover.
- TypeScript declarations, JSON CLI and a runnable loopback HTTP worker example.
- A responsive policy playground sharing the SDK's admission arithmetic, with a self-contained offline HTML download.
- Process-race, crash, lock-failure, rollback, CLI, package, parity and browser checks.
