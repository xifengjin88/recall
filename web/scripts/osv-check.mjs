// Checks every installed package version (from package-lock.json) against OSV.dev,
// which aggregates CVEs from NVD, GitHub advisories and others. Exits 1 on any hit.
import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const seen = new Map();
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || !info.version) continue;
  const name = info.name ?? path.split("node_modules/").pop();
  seen.set(`${name}@${info.version}`, { package: { name, ecosystem: "npm" }, version: info.version });
}
const queries = [...seen.values()];
const res = await fetch("https://api.osv.dev/v1/querybatch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ queries }),
});
if (!res.ok) {
  console.error(`OSV query failed: ${res.status}`);
  process.exit(2);
}
const { results } = await res.json();
const hits = results.map((r, i) => [queries[i], r.vulns ?? []]).filter(([, v]) => v.length);
console.log(`OSV.dev: ${queries.length} package versions checked, ${hits.length} with known vulnerabilities`);
for (const [q, v] of hits) console.log(`  ${q.package.name}@${q.version}: ${v.map((x) => x.id).join(", ")}`);
process.exit(hits.length ? 1 : 0);
