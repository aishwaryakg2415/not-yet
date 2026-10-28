import { INGREDIENTS, byId, detectIngredients, judge, basicRoutine, needs } from "./engine.js";
import { LANGS, T, summaryText } from "./i18n.js";

const $ = id => document.getElementById(id);
const EN = T.en;
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const pref = { get() { try { return localStorage.getItem("ny.lang") || "en"; } catch { return "en"; } }, set(v) { try { localStorage.setItem("ny.lang", v); } catch {} } };
const list = cs => cs.map(c => EN.concern[c].toLowerCase()).join(", ") || "nothing specific";

const state = { picked: new Set(), photo: null, scan: null, step: "product" };

let toastTimer;
function toast(msg) {
  $("toast").textContent = msg; $("toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2600);
}

// ---- screens: step 1 (product) -> step 2 (you + selfie) -> result ----
function showStep(step) {
  state.step = step;
  $("form").hidden = step === "result";
  $("stepProduct").hidden = step !== "product";
  $("stepYou").hidden = step !== "you";
  $("result").hidden = step !== "result";
  $("backBtn").hidden = step !== "you";
  window.scrollTo(0, 0);
}
$("backBtn").onclick = () => showStep("product");
// With a scan already done (same person, another product), skip straight to the new verdict.
$("nextBtn").onclick = () => { if (state.scan) return showResult(); showStep("you"); updateForm(); };

// ---- bottom tab bar ----
function showView(view) {
  for (const t of document.querySelectorAll(".tab")) { const on = t.dataset.view === view; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); }
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== view;
  $("backBtn").hidden = view !== "check" || state.step !== "you";
  window.scrollTo(0, 0);
}
for (const t of document.querySelectorAll(".tab")) {
  t.onclick = () => {
    if (t.dataset.view !== "ask") return showView(t.dataset.view);
    // "Ask" is about a checked product: jump to the questions, or explain what to do first.
    if (!state.result || $("askCard").hidden) { showView("check"); return toast(state.result ? "Questions need a Gemini key on the server." : "Check a product first, then ask anything about it."); }
    showView("check");
    for (const o of document.querySelectorAll(".tab")) o.classList.toggle("on", o === t);
    $("askCard").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => $("askInput").focus({ preventScroll: true }), 400);
  };
}

// ---- step 1: the product ----
const chipList = INGREDIENTS.filter(i => !i.always).concat(INGREDIENTS.filter(i => i.always));
$("ingChips").innerHTML = chipList.map(i => `<button type="button" class="chip" data-id="${i.id}" aria-pressed="false">${esc(i.name)}</button>`).join("");
function renderChips() {
  for (const b of $("ingChips").children) b.setAttribute("aria-pressed", state.picked.has(b.dataset.id));
  const n = state.picked.size;
  $("detected").textContent = n ? `${n} ingredient${n > 1 ? "s" : ""} selected · tap to change` : "Ingredients we look for";
}
$("ingChips").onclick = e => {
  const id = e.target.dataset?.id; if (!id) return;
  state.picked.has(id) ? state.picked.delete(id) : state.picked.add(id);
  if (!state.source) state.source = "manual";
  renderChips(); updateForm();
};
const autodetect = () => { for (const id of detectIngredients(`${$("product").value} ${$("inci").value}`)) state.picked.add(id); renderChips(); updateForm(); };
$("inci").oninput = () => { state.source = "manual"; autodetect(); };
$("product").oninput = () => updateForm();
$("pasteChip").onclick = () => { $("manual").open = true; $("inci").focus(); };

const findStatus = (msg, err = false) => { $("findStatus").textContent = msg; $("findStatus").classList.toggle("err", err); };

async function lookup(params) {
  findStatus("Searching…"); $("results").innerHTML = ""; $("pickedBox").hidden = true;
  try {
    const r = await fetch(`/api/products?${new URLSearchParams(params)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.message ?? "Search failed.");
    state.found = j.products;
    if (!j.products.length) {
      findStatus(params.code ? "That barcode isn't in the database. Try the product name." : "No products found. Try fewer words, or paste the ingredient list.", true);
      if (!params.code) { autodetect(); state.source = "name"; renderPicked(); }
      return;
    }
    findStatus((j.corrected ? `Showing results for "${j.corrected}". ` : "") +
      (j.exact === false ? "No exact match. Closest products:" : j.products.length > 1 ? "Tap your product" : ""));
    if (j.products.length === 1 && params.code) return pick(0);
    $("results").innerHTML = j.products.map((p, i) => {
      const badge = p.source === "shop" ? `<span class="badge b-off">✓ OFFICIAL SITE</span>` : p.ingredients ? `<span class="badge b-db">DATABASE</span>` : `<span class="badge b-none">NO LIST</span>`;
      return `<li><button type="button" data-i="${i}">
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}
        <span><b>${esc(p.name)}</b><span class="muted">${badge}${esc(p.brand)}</span></span>
      </button></li>`;
    }).join("");
  } catch (err) { findStatus(err.message, true); }
}

async function pick(i) {
  const p = state.found[i];
  $("results").innerHTML = ""; findStatus("");
  $("product").value = p.brand && !p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name;
  state.url = null; state.kind = null; state.price = p.price ?? null;
  let ingredients = p.ingredients;
  if (p.source === "shop") {
    // Retrieve the official product page and extract its ingredient list (server-side).
    findStatus(`Reading the ingredient list on ${p.domain}…`);
    $("nextBtn").disabled = true;
    try {
      const r = await fetch(`/api/shop-ingredients?${new URLSearchParams({ domain: p.domain, path: p.path })}`);
      const j = await r.json();
      if (!r.ok) throw new Error();
      ingredients = j.ingredients; state.url = j.url; state.kind = j.kind;
    } catch { ingredients = ""; }
    findStatus("");
  }
  $("inci").value = ingredients;
  state.picked = new Set(detectIngredients(`${p.name} ${ingredients}`));
  state.source = !ingredients ? "name" : p.source === "shop" ? "web" : "list";
  renderChips(); renderPicked(); updateForm();
}

function renderPicked() {
  const ids = [...state.picked];
  const names = ids.map(id => byId[id].name).join(", ");
  const found = ids.length ? `Active ingredients: ${esc(names)}.` : "No active ingredients we check for (a basic product).";
  const site = state.url ? `<a href="${esc(state.url)}" target="_blank" rel="noopener">${esc(new URL(state.url).hostname)}</a>` : "";
  const box = $("pickedBox");
  box.hidden = false;
  box.className = `found ${state.source === "list" || state.source === "web" ? "ok" : "guess"}`;
  box.innerHTML =
    state.source === "web" && state.kind === "key" ? `<b>Only the key ingredients are listed</b> on ${site}.<br>${found} The full list may have more: check the box.`
    : state.source === "web" ? `<b>✓ Ingredient list from the official site</b> (${site}).<br>${found}`
    : state.source === "list" ? `<b>✓ Ingredient list found.</b><br>${found}`
    : `<b>No ingredient list ${state.url ? `on ${site}` : "for this product"}.</b><br>${ids.length ? `From the name we think it has: ${esc(names)}.` : "We couldn't tell from the name."} Check the box and paste the ingredients to be sure.`;
  if (state.source === "name") $("manual").open = true;
}

$("results").onclick = e => { const b = e.target.closest("button[data-i]"); if (b) pick(Number(b.dataset.i)); };
$("findBtn").onclick = () => {
  const q = $("product").value.trim();
  if (q.length < 3) return findStatus("Type the product name first (at least 3 letters).", true);
  lookup({ q });
};
$("product").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("findBtn").click(); } };
$("codeBtn").onclick = () => {
  const code = $("barcode").value.replace(/\D/g, "");
  if (code.length < 8) return findStatus("A barcode has 8 to 14 digits.", true);
  lookup({ code });
};

// Camera barcode reading where the browser supports it (Chrome on Android).
if ("BarcodeDetector" in window) {
  $("barcodeBtn").hidden = false;
  $("barcodePhoto").onchange = async e => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const codes = await new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] }).detect(await createImageBitmap(f));
      if (!codes.length) return findStatus("No barcode found in that photo. Hold the phone closer and try again.", true);
      $("barcode").value = codes[0].rawValue;
      lookup({ code: codes[0].rawValue });
    } catch { findStatus("Couldn't read the barcode. Type the number instead.", true); }
    e.target.value = "";
  };
}

// ---- step 2: about you + selfie ----
const age = () => Number($("age").value) || 0;
const hasProduct = () => !!(state.picked.size || $("product").value.trim() || $("inci").value.trim());
function updateForm() {
  $("nextBtn").disabled = !hasProduct();
  $("nextBtn").innerHTML = state.scan ? `Check it with the same scan <span class="spark">→</span>` : `Next: about you <span class="spark">→</span>`;
  const a = age();
  $("parentBox").hidden = !(a > 0 && a < 18);
  const consentOk = $("consent").checked && (a >= 18 || $("parent").checked);
  const ready = a >= 8 && consentOk;
  $("photo").disabled = !ready;
  $("photoLabel").classList.toggle("off", !ready);
  $("ovalText").textContent = ready ? "Tap to take a selfie" : a >= 8 ? "Tick the consent first" : "Fill in your age first";
  $("checkBtn").disabled = !(ready && state.photo && hasProduct());
  $("checkBtn").innerHTML = `${state.scan ? "Check it · same scan" : "Check it"} <span class="spark">→</span>`;
}
for (const id of ["age", "consent", "parent", "sensitive"]) $(id).addEventListener("input", updateForm);
const stepAge = d => { $("age").value = Math.min(99, Math.max(8, (age() || 15 - d) + d)); updateForm(); };
$("ageMinus").onclick = () => stepAge(-1);
$("agePlus").onclick = () => stepAge(1);

/** Shrink the phone photo before upload: long side <= 1920 px, JPEG. EXIF rotation is applied. */
async function preparePhoto(file) {
  const img = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  if (Math.min(c.width, c.height) < 480) throw new Error("The photo is too small. Use the phone's front camera at full quality.");
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
}
$("photo").onchange = async e => {
  const f = e.target.files?.[0]; if (!f) return;
  setStatus("");
  try {
    state.photo = await preparePhoto(f);
    state.scan = null; // new face, new scan
    $("preview").style.backgroundImage = `url(${URL.createObjectURL(state.photo)})`;
    $("preview").classList.add("has-photo");
  } catch (err) { state.photo = null; setStatus(err.message, true); }
  updateForm();
};

function setStatus(msg, err = false) { $("status").textContent = msg; $("status").classList.toggle("err", err); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scan(blob) {
  const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message ?? (j.error === "daily_limit" ? "Today's live scan limit is used up. Try again tomorrow." : `Could not start the scan (${j.error}).`));
  for (let i = 0; i < 40; i++) {
    await sleep(i === 0 ? 1500 : 2500);
    const p = await (await fetch(`/api/scan/${encodeURIComponent(j.taskId)}`)).json();
    if (p.state === "success") return p;
    if (p.state === "error") throw new Error(p.message);
    if (p.error) throw new Error(`Scan failed (${p.error}).`);
  }
  throw new Error("The scan is taking too long. Please try again.");
}

$("checkBtn").onclick = async () => {
  $("checkBtn").disabled = true;
  try {
    if (!state.scan) { setStatus("Reading your skin… (about 10 seconds)"); state.scan = await scan(state.photo); }
    setStatus("");
    showResult();
  } catch (err) { setStatus(err.message, true); }
  updateForm();
};

// No selfie? A sample teen's scan (bundled with the server), so anyone can try the whole flow. Costs no units.
$("exampleBtn").onclick = async () => {
  if (!hasProduct()) { showStep("product"); return toast("Pick or paste a product first."); }
  if (!age()) $("age").value = 15;
  setStatus("Loading the example scan…");
  try {
    const p = await (await fetch("/api/scan/demo")).json();
    if (p.state !== "success") throw new Error();
    state.scan = { ...p, example: true }; state.photo = null;
    $("photo").value = ""; $("preview").style.backgroundImage = ""; $("preview").classList.remove("has-photo");
    setStatus(""); showResult();
  } catch { setStatus("Couldn't load the example scan. Please try again.", true); }
  updateForm();
};

// ---- result ----
const ICON = {
  x: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7 7 17" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`,
  warn: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 6v8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="18.5" r="1.8" fill="#fff"/></svg>`,
  check: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  doc: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`,
  q: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.2-1.5 2.2v.4" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="18.5" r="1.6" fill="#fff"/></svg>`,
};
const VERDICT_UI = {
  "not-yet": { icon: ICON.x, cls: "v-stop", title: "Not yet.", sub: r => `This product is made for ${list(r.targets)}. Your skin is already healthy there, so you don't need it right now.` },
  "too-strong": { icon: ICON.warn, cls: "v-warn", title: "Too strong, for now.", sub: r => `It targets something real (${list(r.helps)}), but it's stronger than your skin needs. There's a gentler option.` },
  "good-fit": { icon: ICON.check, cls: "v-go", title: "A good fit.", sub: r => r.helps.length ? `It targets ${list(r.helps)}, which your skin actually needs.` : "Sunscreen is good for everyone, every day." },
  "doctor-only": { icon: ICON.doc, cls: "v-doc", title: "Ask a doctor first.", sub: () => "This has a prescription-strength ingredient. Only use it if a doctor gives it to you." },
  unknown: { icon: ICON.q, cls: "v-unk", title: "We can't tell yet.", sub: () => "We didn't recognise any ingredients. Paste the ingredient list or pick what's in it." },
};

/** One evidence row under the verdict: [class, label, value]. */
function reasonRow(x) {
  const ing = x.ingredient && byId[x.ingredient];
  switch (x.type) {
    case "fine": return ["good", EN.concern[x.concern], `${Math.round(x.score)} · already healthy`];
    case "helps": return ["good", EN.concern[x.concern], `${Math.round(x.score)} · a real need`];
    case "age": return ["bad", ing.name, `usually ${x.minAge}+`];
    case "strength": return ["bad", ing.name, "too strong for now"];
    case "doctor": return ["bad", ing.name, "prescription only"];
    case "sunscreen": return ["good", "Sunscreen", "good for everyone"];
    default: return null;
  }
}
const overallWord = n => n == null ? "Score" : n >= 85 ? "Very healthy" : n >= 70 ? "Healthy" : n >= 55 ? "Fair" : "Needs care";

function showResult() {
  const { scores, overall, skinAge } = state.scan;
  const r = judge({ scores, age: age(), ingredients: [...state.picked], sensitive: $("sensitive").checked });
  const ui = VERDICT_UI[r.verdict];
  state.result = r;
  showStep("result");

  $("verdictCard").className = `verdict ${ui.cls}`;
  $("vIcon").innerHTML = ui.icon;
  $("vTitle").textContent = ui.title;
  $("vName").textContent = $("product").value.trim();
  $("vSub").textContent = ui.sub(r);
  const rows = r.reasons.map(reasonRow).filter(Boolean);
  const notes = [...new Set(r.reasons.filter(x => x.ingredient).map(x => byId[x.ingredient].note))];
  $("vReasons").innerHTML = rows.map(([cls, label, value]) => `<div class="reason ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join("")
    + notes.map(n => `<div class="reason note">${esc(n)}</div>`).join("");
  $("vSrc").textContent = { list: "Based on the product's ingredient list (Open Beauty Facts).", web: `Based on the ingredient list on the brand's official site${state.url ? ` (${new URL(state.url).hostname})` : ""}.`, name: "Based on the product name only: no ingredient list was found.", manual: "Based on the ingredients you entered." }[state.source] ?? "";

  $("exampleNote").hidden = !state.scan.example;
  renderSaved(r.verdict);
  remember(r.verdict);
  renderMasks(r);
  loadRealProducts(r);

  $("skinAge").textContent = skinAge ?? "–";
  $("dialAge").style.setProperty("--p", Math.min(100, skinAge ?? 0));
  $("overall").textContent = overall != null ? Math.round(overall) : "–";
  $("dialOverall").style.setProperty("--p", Math.round(overall ?? 0));
  $("overallWord").textContent = overallWord(overall);

  $("bars").innerHTML = needs(scores).map(({ concern: c, score }) => {
    const s = Math.round(score);
    const cls = [s >= 85 ? "ok" : s >= 70 ? "mid" : "", r.top.includes(c) ? "focus" : "", r.targets.includes(c) ? "target" : ""].join(" ");
    return `<div class="bar ${cls}"><span class="nm">${EN.concern[c]}${r.targets.includes(c) ? " ◂" : ""}</span><span class="track"><span class="fill" style="width:${s}%"></span></span><b>${s}</b></div>`;
  }).join("");

  $("insteadCard").hidden = r.verdict === "good-fit" || !r.alternatives.length;
  $("instead").innerHTML = r.alternatives.map(i => `
    <div class="instead">
      <div class="drop"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" fill="#fff"/></svg></div>
      <div class="body"><div class="ghead"><b>${esc(i.name)}</b><span class="pill s-${i.strength}">${STRENGTH[i.strength]}</span></div>
        <p class="gnote">For ${list(i.targets.filter(c => r.top.includes(c)))}. ${esc(i.note)}</p></div>
    </div>`).join("");

  state.routine = basicRoutine(scores, age(), $("sensitive").checked);
  $("routine").innerHTML = state.routine.map(s => `<li><span><b>${EN.step[s.step]}</b>${EN.kind[s.kind]}</span></li>`).join("");

  $("shareTitle").textContent = age() < 18 ? "Send to your parent" : "Share it";
  $("lang").value = pref.get();
  renderSummary();
  $("answers").innerHTML = ""; $("askInput").value = "";
}

// ---- money saved: skipping a product your skin doesn't need ----
const saved = {
  get() { try { return JSON.parse(localStorage.getItem("ny.saved") || "{}"); } catch { return {}; } },
  set(v) { try { localStorage.setItem("ny.saved", JSON.stringify(v)); } catch {} },
};
const rupees = n => "₹" + Math.round(n).toLocaleString("en-IN");
function renderSaved(verdict) {
  const skip = verdict === "not-yet" || verdict === "too-strong";
  $("vSaved").hidden = !(skip && state.price);
  if ($("vSaved").hidden) return;
  let text = `Skipping it saves you ${rupees(state.price)}.`;
  if (!state.scan.example) { // only real checks count towards the running total
    const all = saved.get(); all[state.url ?? $("product").value.trim()] = state.price; saved.set(all);
    const total = Object.values(all).reduce((a, b) => a + b, 0);
    if (total > state.price) text += ` Total saved with Not Yet: ${rupees(total)}.`;
  }
  $("vSaved").textContent = text;
}

// ---- compare: every product checked against the same scan, best fit first ----
const RANK = { "good-fit": 0, "too-strong": 1, "not-yet": 2, "doctor-only": 3, unknown: 4 };
function remember(verdict) {
  const name = $("product").value.trim() || "Product";
  state.history = (state.history ?? []).filter(h => h.name !== name).concat({ name, verdict, price: state.price });
  const list = [...state.history].sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);
  $("compareCard").hidden = list.length < 2;
  $("compare").innerHTML = list.map(h => `<li class="c-${h.verdict}"><span>${esc(h.name)}</span><b>${esc(VERDICT_UI[h.verdict].title.replace(/\.$/, ""))}</b></li>`).join("");
}

// ---- see it on your skin: YouCam's per-concern masks over the analysed photo ----
function renderMasks(r) {
  const { masks = {}, photo } = state.scan;
  const show = [...new Set([...r.top, ...r.targets])].filter(c => masks[c]);
  $("maskCard").hidden = !show.length || !photo;
  if ($("maskCard").hidden) return;
  $("maskBase").src = photo;
  const pickMask = c => {
    $("maskLayer").src = masks[c];
    for (const b of $("maskChips").children) b.classList.toggle("on", b.dataset.c === c);
  };
  $("maskChips").innerHTML = show.map(c => `<button type="button" class="chip" data-c="${c}">${EN.concern[c]} · ${Math.round(state.scan.scores[c])}</button>`).join("");
  $("maskChips").onclick = e => { const b = e.target.closest("button[data-c]"); if (b) pickMask(b.dataset.c); };
  pickMask(show[0]);
}

// ---- real products that fit: searched in brand stores, checked against their official ingredient lists ----
let realReq = 0;
async function loadRealProducts(r) {
  const req = ++realReq;
  const ids = r.alternatives.map(i => i.id);
  $("realBox").hidden = !ids.length || r.verdict === "good-fit";
  if ($("realBox").hidden) return;
  $("real").innerHTML = `<li class="loading">Finding real products that fit your skin…</li>`;
  try {
    const res = await fetch("/api/alternatives", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients: ids, scores: state.scan.scores, age: age(), sensitive: $("sensitive").checked }) });
    const j = await res.json();
    if (req !== realReq) return; // a newer check started
    if (!j.products?.length) { $("realBox").hidden = true; return; }
    $("real").innerHTML = j.products.map(p => `
      <li><a href="${esc(p.url)}" target="_blank" rel="noopener">
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}
        <span class="rb"><b>${esc(p.name)}</b><span class="muted">${esc(p.brand)}${p.price ? ` · ${rupees(p.price)}` : ""}</span>
          <span class="fit">A good fit · for ${list(p.helps)}</span></span>
        <span class="arrow" aria-hidden="true">↗</span>
      </a></li>`).join("");
  } catch { if (req === realReq) $("realBox").hidden = true; }
}

// ---- ask about this product (RAG on the server: retrieve sources, Gemini answers from them only) ----
const SUGGESTED = ["Can I use this every day?", "Why did I get this verdict?", "Can I use it with a salicylic acid face wash?", "What if my skin stings?"];
$("askChips").innerHTML = SUGGESTED.map(q => `<button type="button" class="chip">${esc(q)}</button>`).join("");
$("askChips").onclick = e => { const b = e.target.closest("button"); if (b) { $("askInput").value = b.textContent; ask(); } };
$("askForm").onsubmit = e => { e.preventDefault(); ask(); };

async function ask() {
  const question = $("askInput").value.trim();
  if (question.length < 3 || $("askBtn").disabled) return;
  const box = document.createElement("div");
  box.className = "qa";
  box.innerHTML = `<div class="q">${esc(question)}</div><div class="a thinking">Thinking…</div>`;
  $("answers").append(box);
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("askBtn").disabled = true; $("askInput").value = "";
  const a = box.querySelector(".a");
  try {
    const r = await fetch("/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, lang: $("lang").value, ctx: {
        product: $("product").value.trim(), ingredientList: $("inci").value.trim(), ingredients: [...state.picked],
        scores: state.scan.scores, age: age(), skinAge: state.scan.skinAge, verdict: state.result.verdict, top: state.result.top,
      } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message ?? "Couldn't get an answer.");
    // Citations [S2] become small numbered markers; the cited sources are listed under the answer.
    const answer = esc(j.answer).replace(/\[(S\d+)\]/g, (_, id) => `<sup class="cite">${id.slice(1)}</sup>`).replace(/\n/g, "<br>");
    a.className = "a";
    a.innerHTML = answer + (j.sources.length
      ? `<ul class="sources">${j.sources.map(s => `<li><sup class="cite">${s.id.slice(1)}</sup> ${esc(s.title)}</li>`).join("")}</ul>`
      : `<p class="small">No source was cited, so treat this answer with care.</p>`);
  } catch (err) {
    a.className = "a err";
    a.textContent = err.message;
  }
  $("askBtn").disabled = false;
}

function renderSummary() {
  $("summary").textContent = summaryText($("lang").value, {
    product: $("product").value.trim(), verdict: state.result.verdict, skinAge: state.scan.skinAge,
    top: state.result.top, alternatives: state.result.alternatives, routine: state.routine, ingredientName: i => i.name,
  });
}
$("lang").innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
$("lang").onchange = () => { pref.set($("lang").value); renderSummary(); };
$("waBtn").onclick = () => window.open(`https://wa.me/?text=${encodeURIComponent($("summary").textContent)}`, "_blank");
$("copyBtn").onclick = async () => {
  try { await navigator.clipboard.writeText($("summary").textContent); toast("Copied"); }
  catch { toast("Select the text to copy it"); }
};

// Another product, same face: no new scan, no new units.
function clearProduct() {
  state.picked.clear(); state.source = null; state.found = []; state.url = null; state.kind = null; state.result = null; state.price = null;
  for (const id of ["product", "inci", "barcode"]) $(id).value = "";
  $("results").innerHTML = ""; $("pickedBox").hidden = true; $("manual").open = false; findStatus("");
}
$("againBtn").onclick = () => { clearProduct(); renderChips(); showStep("product"); updateForm(); };
$("newBtn").onclick = () => {
  clearProduct(); state.photo = null; state.scan = null; state.history = [];
  $("age").value = "";
  for (const id of ["consent", "parent", "sensitive"]) $(id).checked = false;
  $("photo").value = ""; $("preview").style.backgroundImage = ""; $("preview").classList.remove("has-photo");
  renderChips(); showStep("product"); updateForm();
};

// ---- guide ----
const STRENGTH = { gentle: "Gentle", moderate: "Medium", strong: "Strong", doctor: "Doctor only" };
function renderGuide(filter = "all") {
  $("guideList").innerHTML = INGREDIENTS.filter(i => filter === "all" || i.strength === filter).map(i => `
    <div class="gcard">
      <div class="ghead"><b>${esc(i.name)}</b><span class="pill s-${i.strength}">${STRENGTH[i.strength]}</span></div>
      <div class="gmeta">${i.targets.length ? "For " + list(i.targets) : "For everyone"}${i.minAge && i.strength !== "doctor" ? ` · usually ${i.minAge}+` : ""}</div>
      <p class="gnote">${esc(i.note)}</p>
    </div>`).join("");
}
$("guideFilters").onclick = e => {
  const b = e.target.closest("button[data-f]"); if (!b) return;
  for (const c of $("guideFilters").children) c.classList.toggle("on", c === b);
  renderGuide(b.dataset.f);
};

// ---- start ----
renderGuide(); renderChips(); updateForm(); showStep("product");
fetch("/api/status").then(r => r.json()).then(s => { $("modeBadge").hidden = !s.demo; $("askCard").hidden = !s.ask; }).catch(() => {});

// Installable app + offline shell. Skipped on plain http other than localhost (browsers require https).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
