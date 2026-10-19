import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync("site/web", { recursive: true });
mkdirSync("site/src", { recursive: true });
copyFileSync("web/index.html", "site/index.html");
for (const file of ["app.js", "app.css", "simulation.js"])
  copyFileSync(`web/${file}`, `site/web/${file}`);
copyFileSync("src/policy.js", "site/src/policy.js");
console.log("Built the static policy playground in site/");
