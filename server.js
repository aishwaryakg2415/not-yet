// Not Yet server: serves the web app and keeps the YouCam API key on the server.
// Zero dependencies (Node 22+). Run: npm run dev   (real API)   or   npm run demo   (no units spent)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONCERNS } from "./public/engine.js";
import { searchProducts, productByCode, correctQuery, tokens } from "./products.js";
import { retrieve, buildPrompt, askGemini, citedIds, cleanCitations } from "./rag.js";
import { shopIngredients } from "./web.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT ?? 3000);
const KEY = process.env.YOUCAM_API_KEY ?? "";
const BASE = process.env.YOUCAM_BASE ?? "https://yce-api-01.makeupar.com";
const DEMO = process.argv.includes("--demo") || process.env.DEMO === "1" || !KEY;
// Protects the free units while judges test the live demo (judging runs until Nov 20).
const MAX_SCANS_PER_DAY = Number(process.env.MAX_SCANS_PER_DAY ?? 30);
const MAX_UPLOAD = 8 * 1024 * 1024;
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
const MAX_ASKS_PER_DAY = Number(process.env.MAX_ASKS_PER_DAY ?? 200);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

// Photo problems YouCam reports, turned into a retake tip. Failed scans cost 0 units.
const RETAKE = {
  error_src_face_too_small: "Move the phone closer: the face should fill most of the photo.",
  error_src_face_out_of_bound: "Keep the whole face inside the photo.",
  error_lighting_dark: "Too dark. Face a window or a bright light.",
  error_below_min_image_size: "The photo is too small. Use the phone's main camera.",
  error_exceed_max_image_size: "The photo is too large. Try again; the app will shrink it.",
  error_no_face: "No face found. Take a straight, front-facing photo.",
};

let day = "", scansToday = 0, asksToday = 0;
function rollDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; scansToday = 0; asksToday = 0; }
}
function takeScanSlot() {
  rollDay();
  if (scansToday >= MAX_SCANS_PER_DAY) return false;
  scansToday++;
  return true;
}
function takeAskSlot() {
  rollDay();
  if (asksToday >= MAX_ASKS_PER_DAY) return false;
  asksToday++;
  return true;
}

class ApiError extends Error {
  constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

async function yc(path, init = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...init.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status === 429 ? 429 : 502, body.error_code ?? `youcam_http_${r.status}`, body.error ?? body);
  return body;
}

async function startScan(bytes) {
  const f = await yc("/s2s/v2.0/file", {
    method: "POST",
    body: JSON.stringify({ files: [{ content_type: "image/jpg", file_name: "selfie.jpg", file_size: bytes.length }] }),
  });
  const file = (f.files ?? f.data?.files)?.[0];
  const req = Array.isArray(file?.requests) ? file.requests[0] : file?.requests;
  if (!file?.file_id || !req?.url) throw new ApiError(502, "bad_file_response", f);
  const headers = Object.fromEntries(Object.entries(req.headers ?? { "Content-Type": "image/jpg" }).filter(([k]) => k.toLowerCase() !== "content-length"));
  const put = await fetch(req.url, { method: req.method ?? "PUT", headers, body: bytes });
  if (!put.ok) throw new ApiError(502, "upload_failed", await put.text());
  const t = await yc("/s2s/v2.0/task/skin-analysis", {
    method: "POST",
    body: JSON.stringify({ src_file_id: file.file_id, dst_actions: CONCERNS, format: "json" }),
  });
  return t.data.task_id;
}

/** Turn YouCam's output list into {scores, overall, skinAge}. Scores are raw_score (not the flattering ui_score). */
export function normalize_(data) {
  if (data.task_status === "running") return { state: "running" };
  if (data.task_status !== "success") {
    const code = data.error ?? "unknown_error";
    return { state: "error", code, message: RETAKE[code] ?? `The scan failed (${code}). Please try again.` };
  }
  const scores = {}, ui = {};
  let overall = null, skinAge = null;
  for (const o of data.results?.output ?? []) {
    if (typeof o.raw_score === "number") { scores[o.type] = Math.round(o.raw_score * 10) / 10; ui[o.type] = o.ui_score; }
    if (o.type === "all") overall = o.score;
    if (o.type === "skin_age") skinAge = o.score;
  }
  return { state: "success", scores, ui, overall, skinAge };
}

async function pollScan(taskId) {
  const j = await yc(`/s2s/v2.0/task/skin-analysis/${encodeURIComponent(taskId)}`);
  return normalize_(j.data ?? {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => { size += c.length; if (size > MAX_UPLOAD) { reject(new ApiError(413, "photo_too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const send = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };

async function api(req, res, url) {
  if (url.pathname === "/api/status") { rollDay(); return send(res, 200, { demo: DEMO, ask: !!GEMINI_KEY, scansLeftToday: Math.max(0, MAX_SCANS_PER_DAY - scansToday) }); }

  if (url.pathname === "/api/ask" && req.method === "POST") {
    if (!GEMINI_KEY) throw new ApiError(503, "ask_unavailable", "Questions need a GEMINI_API_KEY in .env.");
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8") || "{}"); } catch { throw new ApiError(400, "bad_json"); }
    const question = String(body.question ?? "").trim().slice(0, 300);
    if (question.length < 3) throw new ApiError(400, "no_question", "Type a question first.");
    if (!takeAskSlot()) throw new ApiError(429, "daily_limit", "Today's question limit is used up. Try again tomorrow.");
    const sources = retrieve(question, body.ctx ?? {});
    try {
      const { text: raw, model } = await askGemini(buildPrompt(question, sources, body.lang), GEMINI_KEY);
      const text = cleanCitations(raw);
      const cited = citedIds(text);
      return send(res, 200, { answer: text, model, sources: sources.filter(s => cited.includes(s.id)).map(({ id, title }) => ({ id, title })) });
    } catch (e) {
      console.error("gemini:", e.message);
      throw new ApiError(e.status === 429 ? 429 : 502, "ask_failed", e.status === 429 ? "The AI is busy (free-tier limit). Wait a minute and try again." : "The AI didn't answer. Please try again.");
    }
  }

  if (url.pathname === "/api/scan" && req.method === "POST") {
    const bytes = await readBody(req);
    if (bytes.length < 1000) throw new ApiError(400, "no_photo");
    if (DEMO) return send(res, 200, { taskId: "demo" });
    if (!takeScanSlot()) throw new ApiError(429, "daily_limit", "Today's scan limit for this demo is used up. Try demo mode.");
    return send(res, 200, { taskId: await startScan(bytes) });
  }

  const m = url.pathname.match(/^\/api\/scan\/([^/]+)$/);
  if (m && req.method === "GET") {
    const id = decodeURIComponent(m[1]);
    if (id === "demo") return send(res, 200, normalize_(JSON.parse(await readFile(join(ROOT, "fixtures", "demo-scan.json"), "utf8"))));
    if (DEMO) throw new ApiError(400, "demo_mode");
    return send(res, 200, await pollScan(id));
  }

  if (url.pathname === "/api/products") {
    const code = (url.searchParams.get("code") ?? "").replace(/\D/g, "");
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (code) return send(res, 200, { products: [await productByCode(code)].filter(Boolean) });
    if (q.length < 3) throw new ApiError(400, "query_too_short", "Type at least 3 letters.");
    const first = await searchProducts(q);
    if (first.exact) return send(res, 200, first);
    const fixed = correctQuery(q);
    if (fixed === tokens(q).join(" ")) return send(res, 200, first);
    const second = await searchProducts(fixed);
    return send(res, 200, second.exact || second.products.length > first.products.length ? { ...second, corrected: fixed } : first);
  }

  // Ingredients for a product found on a brand's own store, extracted from its official page.
  if (url.pathname === "/api/shop-ingredients") {
    return send(res, 200, await shopIngredients(url.searchParams.get("domain") ?? "", url.searchParams.get("path") ?? "", GEMINI_KEY));
  }

  if (url.pathname === "/api/credit") {
    if (DEMO) return send(res, 200, { demo: true });
    const j = await yc("/s2s/v1.0/client/credit");
    return send(res, 200, { units: (j.results ?? []).reduce((s, x) => s + (x.amount ?? 0), 0) });
  }

  throw new ApiError(404, "not_found");
}

async function file(res, pathname) {
  const rel = normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname)).replace(/^([/\\])+/, "");
  const full = join(PUBLIC, rel);
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(full);
    res.writeHead(200, { "Content-Type": MIME[extname(full)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else await file(res, url.pathname);
  } catch (e) {
    const status = typeof e.status === "number" && e.code ? e.status : 500;
    if (status >= 500) console.error(e.code ?? e, e.detail ?? "");
    if (!res.headersSent) send(res, status, { error: e.code ?? "server_error", message: typeof e.detail === "string" ? e.detail : undefined });
  }
}).listen(PORT, () => console.log(`Not Yet on http://localhost:${PORT} ${DEMO ? "(DEMO mode: no YouCam units are used)" : "(LIVE: YouCam API)"}`));
