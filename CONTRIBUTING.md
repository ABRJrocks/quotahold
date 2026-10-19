# Contributing

Describe the concrete lifecycle or accounting behavior, a minimal public reproduction, and the expected units/states. Do not attach private ledgers or credentials.

Run `npm ci`, `npm test`, `npm run check`, `npm run format:check` and `npm run verify:package`. Playground changes should also run `npm run test:browser` after installing Chromium with Playwright. Add a focused regression check for changed admission, replay or state-transition semantics. Keep the SDK's runtime dependencies at zero unless a demonstrated requirement justifies reconsidering that boundary.

Document compatibility changes to the SQLite schema, windows, usage arithmetic or recovery semantics. Do not present the simulation as a benchmark or proof of provider billing correctness.
