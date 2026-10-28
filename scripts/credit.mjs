// Prints your remaining YouCam units. Usage: node credit.mjs
const r = await fetch("https://yce-api-01.makeupar.com/s2s/v1.0/client/credit", {
  headers: { Authorization: `Bearer ${process.env.YOUCAM_API_KEY}` },
});
console.log(r.status, JSON.stringify(await r.json().catch(() => null), null, 2));
