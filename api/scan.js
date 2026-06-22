// Auto-detect documents added ANYWHERE under the Sentinel library — via the dashboard QR
// uploader, OneDrive, or directly in SharePoint. Uses Microsoft Graph "delta" on the docs
// library: primes to "now" on first run, then each call processes only files added/changed
// since last time and matches them to items by folder + filename. Results ->
// _Sentinel/auto_detected.json (kept on the OneDrive app-state drive), which /api/uploads-map
// merges into what the dashboard reads (the dashboard live-syncs every ~45s).
const { accessToken, docsRoot, docsPathFromUrl, drivePath, readJsonAt, writeJsonAt, dateFromName } = require("../lib/graph");
const data = require("../data.json");

// app-state stays on the OneDrive drive (decoupled from where documents live)
const STATE = drivePath("_Sentinel/scan_state.json");
const DETECTED = drivePath("_Sentinel/auto_detected.json");

// Filename keyword rules per category (ported from generate_data.py).
const FILE_RULES = {
  "ACLS Certification": "\\bacls\\b",
  "ATLS Certification": "\\batls\\b",
  "PALS Certification": "\\bpals\\b",
  "BLS Certification": "\\bbls\\b",
  "State Medical License": "tmb[ ]*cert|medical license|tmb certificate|tmb[ ]+\\d",
  "Medical License Verify (annual)": "tmb[ ]*ver|tmb veri",
  "Individual DEA Registration": "dea[ ]*cert|dea certificate|^dea ",
  "DEA Verify (annual)": "dea[ ]*ver",
  "Influenza Vaccination": "flu|influenza",
  "TB Screening": "\\btb\\b|ppd|tubercul|quantiferon|\\bcxr\\b|chest",
  "Driver's License": "txdl|driver|\\bdl[ ]",
  "NPDB Query (2 yrs)": "npdb",
  "OIG / SAM Exclusion Check": "oig|sam |exclusion",
  "NPI Verification": "nppes|\\bnpi\\b",
  "TSCA Documents": "tsca",
  "CME (20 hrs / 2 yrs)": "\\bcme\\b",
  "Delineation of Privileges (DOP)": "privilege|\\bdop\\b",
  "Peer References": "reference|peer",
  "Initial Application": "application|initial app",
  "CV / Resume": "\\bcv\\b|resume|curriculum",
  "Medical Diploma": "diploma|medical school|ecfmg",
  "Malpractice / COI Insurance": "malpractice|certificate of insurance|\\bcoi\\b|tail coverage|policy",
  "Board Certification": "board|recert"
};
function normf(s) { return String(s).toLowerCase().replace(/_/g, " ").replace(/ii/g, "i"); }

// Build folder -> items index keyed by the docs-library-relative folder path
// (derived from each item's SharePoint folderLink URL).
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
// Which item does a file (in folderRel, named fileName) belong to?
function matchItem(folderRel, fileName) {
  const { folders, rels } = index();
  const rel = rels.find(r => folderRel === r || folderRel.startsWith(r + "/"));
  if (!rel) return null;
  const nf = normf(fileName);
  for (const it of folders[rel]) {
    const rule = FILE_RULES[it.category];
    if (rule && new RegExp(rule, "i").test(nf)) return it;
  }
  return null;
}
// Pull the library-relative path out of a Graph parentReference.path
// e.g. "/drives/<id>/root:/Sama Farooqui/Sentinel/Provider/X" -> "Sama Farooqui/Sentinel/Provider/X"
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
    // First run (or migrating off the old OneDrive delta): prime to "now" against the docs
    // library so we don't enumerate the whole archive. driveTag invalidates any stale token.
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
    while (next && pages < 8 && Date.now() - start < 8000) {
      const r = await fetch(next, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) break;
      const j = await r.json();
      for (const v of (j.value || [])) {
        const folderRel = relFromParent((v.parentReference && v.parentReference.path) || "");
        if (!folderRel || folderRel.indexOf("Sentinel/") < 0) continue;   // only the Sentinel tree
        if (!v.file && !v.deleted) continue;
        const it = matchItem(folderRel, v.name || "");
        if (!it) continue;
        if (v.deleted) { if (detected[it.id] && detected[it.id].name === v.name) { delete detected[it.id]; changed++; } }
        else { detected[it.id] = { url: v.webUrl || "", name: v.name, date: dateFromName(v.name) }; changed++; }
      }
      next = j["@odata.nextLink"]; deltaLink = j["@odata.deltaLink"] || deltaLink; pages++;
    }
    if (changed) await writeJsonAt(token, DETECTED, detected);
    await writeJsonAt(token, STATE, { deltaLink: deltaLink || next || state.deltaLink, driveTag: "docs-v1" });
    res.status(200).json({ ok: true, changed, items: Object.keys(detected).length });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
