import { Ledger } from "../src/index.js";
const [path, operation, key] = process.argv.slice(2);
const ledger = new Ledger(path, { clock: () => 120 });
try {
  if (operation === "reserve")
    console.log(
      JSON.stringify(
        ledger.reserve("team", {
          key,
          fingerprint: "a".repeat(64),
          estimate: 20,
        }),
      ),
    );
  else if (operation === "start") {
    try {
      ledger.start("team", key);
      console.log("started");
    } catch (error) {
      if (error.code !== "STATE") throw error;
      console.log("rejected");
    }
  } else if (operation === "crash") {
    ledger.start("team", key);
    process.exit(17);
  }
} finally {
  ledger.close();
}
