#!/usr/bin/env node
import { openSync, readSync, closeSync } from "node:fs";
import { parseArgs } from "node:util";
import { Ledger } from "./ledger.js";
import { QuotaError } from "./policy.js";

export function main(argv = process.argv.slice(2)) {
  let ledger;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        scope: { type: "string" },
        input: { type: "string" },
        id: { type: "string" },
        after: { type: "string" },
        limit: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
    if (values.help || argv.length === 0) {
      console.log(
        "QuotaHold 0.1.0\nUsage: quotahold <init|configure|reserve|start|uncertain|cancel|settle|status|list|events> PATH --scope NAME [--input FILE] [--id ID]\nJSON input files are required for configure, reserve and settle. Lists accept --limit and --after.\nNode 24.15+; integer application units; trusted local SQLite only.",
      );
      return 0;
    }
    if (values.version) {
      console.log("0.1.0");
      return 0;
    }
    const [command, path] = positionals;
    if (
      positionals.length !== 2 ||
      ![
        "init",
        "configure",
        "reserve",
        "start",
        "uncertain",
        "cancel",
        "settle",
        "status",
        "list",
        "events",
      ].includes(command)
    )
      throw new QuotaError(
        "INPUT",
        "Choose a supported command and one database path",
      );
    if (command === "init") {
      ledger = Ledger.create(path);
      console.log(JSON.stringify({ created: true }));
      return 0;
    }
    if (!values.scope)
      throw new QuotaError("INPUT", "An explicit --scope is required");
    ledger = new Ledger(path);
    const read = () => {
      if (!values.input)
        throw new QuotaError("INPUT", "This command requires --input FILE");
      const handle = openSync(values.input, "r");
      const buffer = Buffer.alloc(16385);
      let length;
      try {
        length = readSync(handle, buffer, 0, buffer.length, 0);
      } finally {
        closeSync(handle);
      }
      if (length > 16384)
        throw new QuotaError("INPUT", "JSON input exceeds 16 KiB");
      const fd = buffer.subarray(0, length);
      let value;
      try {
        value = JSON.parse(fd.toString("utf8"));
      } catch {
        throw new QuotaError("INPUT", "Input must be valid JSON");
      }
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new QuotaError("INPUT", "JSON input must be an object");
      return value;
    };
    let result;
    if (command === "configure")
      result = ledger.configure(values.scope, read());
    else if (command === "reserve")
      result = ledger.reserve(values.scope, read());
    else if (command === "settle")
      result = ledger.settle(values.scope, values.id, read());
    else if (["start", "uncertain", "cancel"].includes(command))
      result = ledger[command](values.scope, values.id);
    else if (command === "status") result = ledger.status(values.scope);
    else
      result = ledger[command](values.scope, {
        ...(values.limit ? { limit: Number(values.limit) } : {}),
        ...(values.after
          ? {
              after: command === "events" ? Number(values.after) : values.after,
            }
          : {}),
      });
    console.log(JSON.stringify(result));
    return result.kind === "denied" ? 3 : 0;
  } catch (error) {
    console.error(
      error instanceof QuotaError
        ? `quotahold: ${error.code}: ${error.message}`
        : "quotahold: Operation failed; check command syntax, file access, database integrity and lock availability",
    );
    return 2;
  } finally {
    ledger?.close();
  }
}
if (import.meta.main) process.exitCode = main();
