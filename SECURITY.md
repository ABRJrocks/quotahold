# Security

QuotaHold is a trusted local coordination component. It provides no authentication, encrypted storage, provider verification or protection against a worker that bypasses its API. Use local files and protect the database directory. Do not accept arbitrary database paths or SQLite uploads from untrusted users. Network filesystems and multi-host access are unsupported.

Request keys, fingerprints, receipts, timestamps and notes are stored in plaintext. Do not store credentials, prompts or sensitive payloads in these fields. A payload hash can still reveal predictable content through guessing. Protect backups with the same care as the live ledger.

An estimate can be wrong. Internal provider retries, manual false settlement or bypassing the library can exceed the intended allowance. This package is not a provider-enforced billing limit. It favors retaining unknown usage over automatically freeing capacity, which may block work until investigated.

For a suspected vulnerability, use private reporting at https://github.com/ABRJrocks/quotahold/security/advisories/new when available. Do not include secrets or private ledger files in public issues. Only the current 0.1.x release line is maintained at launch.
