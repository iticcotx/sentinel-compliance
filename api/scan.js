// Auto-detect documents added ANYWHERE under the Sentinel library — via the dashboard QR
// uploader, OneDrive, or directly in SharePoint. Graph "delta" finds new/changed files and
// matches them to items. For matched files with no date in the filename, it then reads the
// expiry by OCR (OCR.space, free) SERVER-SIDE — so dates fill in automatically, no opening.
// Results -> _Sentinel/auto_detected.json, which /api/uploads-map merges into the dashboard.
const { accessToken, docsRoot, docsPathFromUrl, encPath, drivePath, readJsonAt, writeJsonAt, dateFromName } = require("../lib/graph");
const data = require("../data.json");

const STATE = drivePath("_Sentinel/scan_state.json");
const DETECTED = drivePath("_Sentinel/auto_detected.json");
const OCR_KEY = process.env.OCR_SPACE_KEY || "helloworld";

const FILE_RULES = {
  "ACLS Certification": "\\bacls\\b", "ATLS Certification": "\\batls\\b", "PALS Certification": "\\bpals\\b",
  "BLS Certification": "\\bbls\\b", "State Medical License": "tmb[ ]*cert|medical license|tmb certificate|tmb[ ]+\\d",
  "Medical License Verify (annual)": "tmb[ ]*ver|tmb veri", "Individual DEA Registration": "dea[ ]*cert|dea certificate|^dea ",
  "DEA Verify (annual)": "dea[ ]*ver", "Influenza Vaccination": "flu|influenza",
  "TB Screening": "\\btb\\b|ppd|tubercul|quantiferon|\\bcxr\\b|chest", "Driver's License": "txdl|driver|\\bdl[ ]",
  "NPDB Query (2 yrs)": "npdb", "OIG / SAM Exclusion Check": "oig|sam |exclusion", "NPI Verification": "nppes|\\bnpi\\b",
  "TSCA Documents": "tsca", "CME (20 hrs / 2 yrs)": "\\bcme\\b", "Delineation of Privileges (DOP)": "privilege|\\bdop\\b",
  "Peer References": "reference|peer", "Initial Application": "application|initial app",
  "CV / Resume": "\\bcv\\b|resume|curriculum", "Medical Diploma": "diploma|medical school|ecfmg",
  "Malpractice / COI Insurance": "malpractice|certificate of insurance|\\bcoi\\b|tail coverage|policy", "Board Certification": "board|recert"
};
function normf(s) { return String(s).toLowerCase().replace(/_/g, " ").replace(/ii/g, "i"); }
function extractDates(text) {
  const out = []; let m;
  const push = (y, mo, d) => { if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0")); };
  const re = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
  while ((m = re.exec(text))) { let y = +m[3]; if (y < 100) y += 2000; push(y, +m[1], +m[2]); }
  const mon = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const re2 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi;
  while ((m = re2.exec(text))) push(+m[3], mon[m[1].toLowerCase().slice(0, 3)], +m[2]);
  return [...new Set(out)].sort();
}
function pickExpiry(dates) {
  if (!dates || !dates.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const fut = dates.filter(d => d >= today);
  return fut.length ? fut[fut.length - 1] : dates[dates.length - 1];
}
// OCR a document by its library path. Returns [dates] (possibly empty) or null on error/throttle.
async function ocrDates(token, folderPath, name) {
  try {
    const url = docsRoot() + "/root:/" + encPath(folderPath + "/" + name) + ":/content";
    const fr = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!fr.ok) return null;
    const ab = await fr.arrayBuffer();
    const fd = new FormData();
    fd.append("apikey", OCR_KEY); fd.append("OCREngine", "2"); fd.append("scale", "true");
    if (/\.pdf$/i.test(name || "")) fd.append("filetype", "PDF");
    fd.append("file", new Blob([ab]), name || "doc");
    const o = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: fd });
    const oj = await o.json().catch(() => ({}));
    if (oj.IsErroredOnProcessing) return null;
    return extractDates((oj.ParsedResults || []).map(p => p.ParsedText || "").join("\n"));
  } catch (e) { return null; }
}

let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  const folders = {};
  for (const it of (data.items || [])) {
    const rel = docsPathFromUrl(it.folderLink || it.fileLink || "");
    if (!rel) continue;
    (folders[rel] = folders[rel] || []).push(it);
  }
  INDEX = { folders, rels: Object.keys(folders).sort((a, b) => b.length - a.length) };
  return INDEX;
}
function matchItem(folderRel, fileName) {
  const { folders, rels } = index();
  const rel = rels.find(r => folderRel === r || folderRel.startsWith(r + "/"));
  if (!rel) return null;
  const nf = normf(fileName);
  for (const it of folders[rel]) { const rule = FILE_RULES[it.category]; if (rule && new RegExp(rule, "i").test(nf)) return it; }
  return null;
}
function relFromParent(path) {
  const i = String(path || "").indexOf("root:");
  if (i < 0) return null;
  let rel = String(path).slice(i + 5).replace(/^\/+/, "");
  try { rel = decodeURIComponent(rel); } catch (e) { }
  return rel;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  try {
    const token = await accessToken();
    const state = (await readJsonAt(token, STATE)) || {};
    if (!state.deltaLink || state.driveTag !== "docs-v1") {
      const r = await fetch(docsRoot() + "/root/delta?token=latest", { headers: { Authorization: "Bearer " + token } });
      const j = await r.json();
      await writeJsonAt(token, STATE, { deltaLink: j["@odata.deltaLink"], driveTag: "docs-v1" });
      res.status(200).json({ ok: true, initialized: true, detected: 0 });
      return;
    }
    const detected = (await readJsonAt(token, DETECTED)) || {};
    let next = state.deltaLink, deltaLink = null, changed = 0, pages = 0;
    const start = Date.now();
    while (next && pages < 8 && Date.now() - start < 4000) {   // keep delta short, leave time for one OCR
      const r = await fetch(next, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) break;
      const j = await r.json();
      for (const v of (j.value || [])) {
        const folderRel = relFromParent((v.parentReference && v.parentReference.path) || "");
        if (!folderRel || folderRel.indexOf("Sentinel/") < 0) continue;
        if (!v.file && !v.deleted) continue;
        const it = matchItem(folderRel, v.name || "");
        if (!it) continue;
        if (v.deleted) { if (detected[it.id] && detected[it.id].name === v.name) { delete detected[it.id]; changed++; } }
        else { detected[it.id] = Object.assign({}, detected[it.id], { url: v.webUrl || "", name: v.name, date: dateFromName(v.name) || (detected[it.id] || {}).date || null }); changed++; }
      }
      next = j["@odata.nextLink"]; deltaLink = j["@odata.deltaLink"] || deltaLink; pages++;
    }
    // Save delta progress BEFORE the (slower) OCR step so nothing is lost on timeout.
    if (changed) await writeJsonAt(token, DETECTED, detected);
    await writeJsonAt(token, STATE, { deltaLink: deltaLink || next || state.deltaLink, driveTag: "docs-v1" });

    // Background OCR: read the expiry for ONE not-yet-read document (keeps each run < 10s).
    let ocrChanged = false, ocred = null;
    const byId = {}; for (const it of (data.items || [])) byId[it.id] = it;
    for (const id in detected) {
      if (Date.now() - start > 5500) break;
      const d = detected[id];
      if (d.date || d.ocrTried) continue;             // already has a date, or already OCR'd with no luck
      const it = byId[id]; if (!it) continue;
      const folderPath = docsPathFromUrl(it.folderLink || it.fileLink || ""); if (!folderPath) continue;
      const dates = await ocrDates(token, folderPath, d.name);
      if (dates === null) continue;                   // transient (throttle/error) — retry next run
      if (dates.length) { d.date = pickExpiry(dates); d.ocr = true; } else { d.ocrTried = true; }
      ocrChanged = true; ocred = { id, date: d.date || null }; break;   // one per run
    }
    if (ocrChanged) await writeJsonAt(token, DETECTED, detected);

    res.status(200).json({ ok: true, changed, items: Object.keys(detected).length, ocr: ocred });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
