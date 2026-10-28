// Prints the unit cost of every YouCam feature. Usage: node costs.mjs
const r = await fetch("https://yce-api-01.makeupar.com/s2s/v2.0/credit/feature-cost", {
  headers: { Authorization: `Bearer ${process.env.YOUCAM_API_KEY}` },
});
const j = await r.json();
const skus = j.result?.skus ?? [];
if (!skus.length) console.log("No costs returned:", JSON.stringify(j).slice(0, 500));
for (const s of skus) console.log(String(s.amount).padStart(3), "units  ", s.description, s.proc_unit > 1 ? `(per ${s.proc_unit} ${s.unit})` : "");
