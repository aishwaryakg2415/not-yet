// First real YouCam call: upload a selfie, run SD skin analysis (4 concerns), print the scores.
// Usage (PowerShell):  $env:YOUCAM_API_KEY="your_key"; node smoke.mjs selfie.jpg
// Saves the full result to sample-scan.json (your offline demo fixture).
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const KEY = process.env.YOUCAM_API_KEY;
const BASE = process.env.YOUCAM_BASE ?? "https://yce-api-01.makeupar.com";
const IMG = process.argv[2];
if (!KEY) { console.error("Set YOUCAM_API_KEY first."); process.exit(1); }
if (!IMG) { console.error("Usage: node smoke.mjs selfie.jpg"); process.exit(1); }

const auth = { Authorization: `Bearer ${KEY}` };
async function call(path, init = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { ...auth, "Content-Type": "application/json", ...init.headers } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) { console.error(`HTTP ${r.status} on ${path}:`, body); if (r.status === 401) console.error("401 = wrong key, or key from the other region's console."); process.exit(1); }
  return body;
}

const bytes = readFileSync(IMG);
const type = extname(IMG).toLowerCase() === ".png" ? "image/png" : "image/jpg";

console.log("== unit costs (shape unverified, printed raw)");
console.log(JSON.stringify(await call("/s2s/v2.0/credit/feature-cost").catch(() => "n/a")).slice(0, 1500));

console.log("== 1. create file");
const f = await call("/s2s/v2.0/file", {
  method: "POST",
  body: JSON.stringify({ files: [{ content_type: type, file_name: "selfie" + extname(IMG), file_size: bytes.length }] }),
});
const file = (f.files ?? f.data?.files)?.[0];
const req = Array.isArray(file?.requests) ? file.requests[0] : file?.requests;
if (!file?.file_id || !req?.url) { console.error("Unexpected file response:", JSON.stringify(f, null, 2)); process.exit(1); }
console.log("file_id:", file.file_id);

console.log("== 2. upload bytes");
const headers = Object.fromEntries(Object.entries(req.headers ?? { "Content-Type": type }).filter(([k]) => k.toLowerCase() !== "content-length"));
const put = await fetch(req.url, { method: req.method ?? "PUT", headers, body: bytes });
console.log("PUT", put.status);
if (!put.ok) { console.error(await put.text()); process.exit(1); }

console.log("== 3. start SD analysis (oiliness, redness, acne, pore)");
const t = await call("/s2s/v2.0/task/skin-analysis", {
  method: "POST",
  body: JSON.stringify({ src_file_id: file.file_id, dst_actions: ["oiliness", "redness", "acne", "pore"], format: "json" }),
});
const taskId = t.data?.task_id;
console.log("task_id:", taskId);

console.log("== 4. poll");
let d;
for (let i = 1; i <= 40; i++) {
  await new Promise(r => setTimeout(r, 3000));
  d = (await call(`/s2s/v2.0/task/skin-analysis/${encodeURIComponent(taskId)}`)).data ?? {};
  console.log(`poll ${i}: ${d.task_status}`);
  if (d.task_status !== "running") break;
}

writeFileSync("sample-scan.json", JSON.stringify(d, null, 2));
if (d.task_status !== "success") {
  console.error("Failed:", d.error, d.error_message ?? "");
  console.error("Tip: face should fill most of the photo, even light, look straight at the camera. Failed scans cost 0 units.");
  process.exit(1);
}
console.log("== scores (higher = healthier)");
for (const o of d.results?.output ?? []) console.log(o.type.padEnd(12), "raw", o.raw_score, " ui", o.ui_score);
console.log("Saved full result to sample-scan.json");
