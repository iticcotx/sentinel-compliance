// Auto-detect documents dropped directly into OneDrive (not via the QR page).
// Uses Microsoft Graph "delta": primes to "now" on first run, then each call
// processes only files added/changed since last time and matches them to items
// (same filename rules as the local matcher). Results -> _Sentinel/auto_detected.json,
// which /api/uploads-map merges into what the dashboard reads.
const { accessToken, driveRoot, drivePath, encPath, readJsonAt, writeJsonAt, dateFromName } = require("../lib/graph");
const data = require("../data.json");

const ROOTSEG = "WCGTX Phyicians_04.08.2020";
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
  "Driver's License": "txdl|driver|\\bdl ",
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

// Build folder -> items index from data.json once.
let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  const folders = {};
  for (const it of (data.items || [])) {
    const fl = it.folderLink || it.fileLink || "";
    if (!fl) continue;
    const rel = fl.replace(/^(\.\.\/)+/, "").replace(/\/+$/, "");
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

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  try {
    const token = await accessToken();
    const state = (await readJsonAt(token, STATE)) || {};
    // First run: prime delta to "now" so we don't enumerate all 24k existing files.
    if (!state.deltaLink) {
      const r = await fetch(driveRoot() + "/root/delta?token=latest", { headers: { Authorization: "Bearer " + token } });
      const j = await r.json();
      await writeJsonAt(token, STATE, { deltaLink: j["@odata.deltaLink"] });
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
        const path = (v.parentReference && v.parentReference.path) || "";
        const i = path.indexOf(ROOTSEG + "/");
        if (i < 0) continue;
        if (!v.file && !v.deleted) continue;
        const folderRel = decodeURIComponent(path.slice(i + ROOTSEG.length + 1));
        const it = matchItem(folderRel, v.name || "");
        if (!it) continue;
        if (v.deleted) { if (detected[it.id] && detected[it.id].name === v.name) { delete detected[it.id]; changed++; } }
        else { detected[it.id] = { url: v.webUrl || "", name: v.name, date: dateFromName(v.name) }; changed++; }
      }
      next = j["@odata.nextLink"]; deltaLink = j["@odata.deltaLink"] || deltaLink; pages++;
    }
    if (changed) await writeJsonAt(token, DETECTED, detected);
    await writeJsonAt(token, STATE, { deltaLink: deltaLink || next || state.deltaLink });
    res.status(200).json({ ok: true, changed, items: Object.keys(detected).length });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
