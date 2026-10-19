import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync("site/web", { recursive: true });
mkdirSync("site/src", { recursive: true });
copyFileSync("web/index.html", "site/index.html");
for (const file of ["app.js", "app.css", "simulation.js"])
  copyFileSync(`web/${file}`, `site/web/${file}`);
copyFileSync("src/policy.js", "site/src/policy.js");
console.log("Built the static policy playground in site/");

// The release also works directly from disk, without module fetches or a server.
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const sources = ["src/policy.js", "web/simulation.js", "web/app.js"].map(
  (path, index) => {
    let source = readFileSync(path, "utf8");
    if (index > 0) {
      const stripped = source.replace(/^import[\s\S]*?from "[^"\n]+";\n/, "");
      assert.notEqual(stripped, source, "Expected one module import");
      source = stripped;
    }
    assert.equal(
      /^import\s/m.test(source),
      false,
      "Unexpected additional import",
    );
    return source.replace(/^export /gm, "");
  },
);
let offline = readFileSync("web/index.html", "utf8");
offline = offline
  .replace("script-src 'self'", "script-src 'unsafe-inline'")
  .replace(
    /<link\s+rel="stylesheet"\s+href="web\/app.css"\s*\/?>/,
    "<style>" + readFileSync("web/app.css", "utf8") + "</style>",
  )
  .replace(
    '<script type="module" src="web/app.js"></script>',
    '<script type="module">' +
      sources.join("\n").replaceAll("</script", "<\\/script") +
      "</script>",
  );
assert.equal(offline.includes('src="web/app.js"'), false);
writeFileSync("site/quotahold-playground.html", offline);
console.log("Built a self-contained offline playground");
