// The roster — served ONLY to a signed-in staff member, FILTERED to the tabs they're allowed.
// Also: ?file=<url>  -> same-origin bytes proxy (for in-browser tools)
//       ?ocr=<url>   -> server-side OCR (OCR.space, free) that returns any dates it reads.
const { getSession } = require("../lib/session");
const data = require("../data.json");

function extractDates(text) {
  const out = [];
  const push = (y, mo, d) => { if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0")); };
  let m;
  const re = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
  while ((m = re.exec(text))) { let y = +m[3]; if (y < 100) y += 2000; push(y, +m[1], +m[2]); }
  const mon = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const re2 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi;
  while ((m = re2.exec(text))) push(+m[3], mon[m[1].toLowerCase().slice(0, 3)], +m[2]);
  return [...new Set(out)].sort();
}
async function resolveDownloadUrl(token, GRAPH, fileUrl) {
  const shareId = "u!" + Buffer.from(fileUrl, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const di = await fetch(GRAPH + "/shares/" + shareId + "/driveItem", { headers: { Authorization: "Bearer " + token } });
  if (!di.ok) return { error: "resolve " + di.status, detail: (await di.text()).slice(0, 160) };
  const item = await di.json();
  const dl = item["@microsoft.graph.downloadUrl"] || item["@content.downloadUrl"];
  if (!dl) return { error: "no download url" };
  return { dl, item };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  // Vercel crons (no user session) are allowed to hit ?regen=1 only.
  const isCron = /vercel-cron/i.test(req.headers["user-agent"] || "");
  const s = getSession(req);
  if (!s && !(isCron && url.searchParams.get("regen") === "1")) { res.status(401).json({ error: "sign-in required" }); return; }

  // ---- hourly cron regen: pull the live Excel + write roster_delta.json to OneDrive.
  //      /api/data merges the delta on every read, so changes propagate within seconds
  //      of the cron firing (not a full Python regen — those need data-entry tools we
  //      can't run server-side without Python). Schedule lives in vercel.json. ----
  if (url.searchParams.get("regen") === "1") {
    if (!isCron && (!s || !s.admin)) { res.status(403).json({ error: "admins only" }); return; }
    try {
      const xl = require("../lib/excel");
      const { accessToken, drivePath, writeJsonAt } = require("../lib/graph");
      const token = await accessToken();
      const [act, inact] = await Promise.all([
        xl.readSheet(token, xl.SHEET_ACTIVE),
        xl.readSheet(token, xl.SHEET_INACTIVE),
      ]);
      const slug = (l, f) => (l + "-" + f).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
      const namesFrom = sh => (sh.values || []).slice(1)
        .map(r => ({ last: String((r[0] || "")).replace(/[\*,()]+/g, "").trim(), first: String((r[1] || "")).trim() }))
        .filter(x => x.last);
      const liveActive = namesFrom(act);
      const liveInactive = namesFrom(inact);
      const liveActiveKeys = new Set(liveActive.map(p => slug(p.last, p.first)));
      const liveInactiveKeys = new Set(liveInactive.map(p => slug(p.last, p.first)));
      // Stub records for providers that exist in the live Excel but aren't yet in the baked data.json.
      // The dashboard will show them as "pending — awaiting roster data" until the next full regen.
      const seedKeys = new Set((data.items || []).filter(i => i.scope === "provider").map(i => i.entityKey));
      const newProviders = liveActive.filter(p => !seedKeys.has(slug(p.last, p.first)));
      const inactivated = (data.items || []).filter(i => i.scope === "provider" && i.active && liveInactiveKeys.has(i.entityKey)).map(i => i.entityKey);
      const removed = (data.items || []).filter(i => i.scope === "provider" && i.active && !liveActiveKeys.has(i.entityKey) && !liveInactiveKeys.has(i.entityKey)).map(i => i.entityKey);
      const delta = { generatedAt: new Date().toISOString(), newProviders, inactivated: [...new Set(inactivated)], removed: [...new Set(removed)] };
      await writeJsonAt(token, drivePath("_Sentinel/roster_delta.json"), delta);
      res.status(200).json({ ok: true, delta: { newProviders: newProviders.length, inactivated: delta.inactivated.length, removed: delta.removed.length } });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    return;
  }

  // ---- roster ops: add/remove a provider in the master Excel (admin-only) ----
  // GET  /api/data?roster=list           -> { active:[{last,first,row}], inactive:[...] }
  // POST /api/data?roster=add            { last, first, email? }
  // POST /api/data?roster=remove         { last, first }       (moves Credentials -> Inactive)
  const rosterAction = url.searchParams.get("roster");
  if (rosterAction) {
    if (!s.admin && rosterAction !== "list") { res.status(403).json({ error: "admins only" }); return; }
    try {
      const xl = require("../lib/excel");
      const { accessToken } = require("../lib/graph");
      const token = await accessToken();
      if (rosterAction === "list") {
        const [a, i] = await Promise.all([xl.readSheet(token, xl.SHEET_ACTIVE), xl.readSheet(token, xl.SHEET_INACTIVE)]);
        const flat = sh => (sh.values || []).slice(1).map((row, idx) => ({ last: row[0] || "", first: row[1] || "", row: idx + 2 }))
          .filter(r => String(r.last).trim());
        res.status(200).json({ active: flat(a), inactive: flat(i) });
        return;
      }
      let body = ""; await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });
      let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) {}
      const last = String(b.last || "").trim();
      const first = String(b.first || "").trim();
      if (!last) { res.status(400).json({ error: "last name required" }); return; }
      if (rosterAction === "add") {
        const dup = await xl.findAnywhere(token, last, first);
        if (dup) { res.status(409).json({ error: "already present", in: dup.sheet, row: dup.rowIndex }); return; }
        await xl.snapshotWorkbook(token, "before-add");   // backup before every write
        const result = await xl.appendRow(token, xl.SHEET_ACTIVE, [last, first]);
        // also append the email (if provided) to the COI roster so reminders/etc reach them
        if (b.email && b.email.includes("@")) {
          try { await xl.appendRow(token, "WCGTX COI Roster", [last, first, null, String(b.email).trim()]); } catch (e) {}
        }
        res.status(200).json({ ok: true, action: "added", sheet: xl.SHEET_ACTIVE, rowIndex: result.rowIndex });
        return;
      }
      if (rosterAction === "remove") {
        // Prefer entityKey when sent (no name-splitting ambiguity); fall back to last/first.
        const entityKey = String(b.entityKey || "").trim();
        let found = null;
        if (entityKey) found = await xl.findRowByEntityKey(token, xl.SHEET_ACTIVE, entityKey);
        if (!found) found = await xl.findRow(token, xl.SHEET_ACTIVE, last, first);
        if (!found) {
          let inact = null;
          if (entityKey) inact = await xl.findRowByEntityKey(token, xl.SHEET_INACTIVE, entityKey);
          if (!inact) inact = await xl.findRow(token, xl.SHEET_INACTIVE, last, first);
          if (inact) { res.status(409).json({ error: "already inactive" }); return; }
          const sh = await xl.readSheet(token, xl.SHEET_ACTIVE);
          const sample = (sh.values || []).slice(1, 12).map(r => ({ last: r[0], first: r[1] })).filter(x => x.last);
          res.status(404).json({
            error: "not found in roster",
            tried: { last, first, entityKey },
            sample,
            hint: "Check that the provider's name appears in the first two columns of the WCGTX Credentials sheet."
          });
          return;
        }
        await xl.snapshotWorkbook(token, "before-remove");
        await xl.moveRow(token, xl.SHEET_ACTIVE, found.rowIndex, xl.SHEET_INACTIVE);
        res.status(200).json({ ok: true, action: "moved to inactive", fromRow: found.rowIndex });
        return;
      }
      res.status(400).json({ error: "roster action must be list, add, or remove" });
      return;
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
      return;
    }
  }

  // ---- server-side OCR (free, OCR.space): read dates off a scanned doc, PDF or image ----
  const ocrUrl = url.searchParams.get("ocr");
  if (ocrUrl) {
    try {
      const { accessToken, GRAPH } = require("../lib/graph");
      const token = await accessToken();
      const r = await resolveDownloadUrl(token, GRAPH, ocrUrl);
      if (r.error) { res.status(502).json({ error: r.error, detail: r.detail }); return; }
      const fileResp = await fetch(r.dl);
      if (!fileResp.ok) { res.status(502).json({ error: "download " + fileResp.status }); return; }
      const ab = await fileResp.arrayBuffer();
      const isPdf = /\.pdf$/i.test(r.item.name || "");
      const key = process.env.OCR_SPACE_KEY || "helloworld";
      const fd = new FormData();
      fd.append("apikey", key); fd.append("OCREngine", "2"); fd.append("scale", "true"); fd.append("isOverlayRequired", "false");
      if (isPdf) fd.append("filetype", "PDF");
      fd.append("file", new Blob([ab], { type: (r.item.file && r.item.file.mimeType) || "application/octet-stream" }), r.item.name || "document");
      const o = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: fd });
      const oj = await o.json().catch(() => ({}));
      if (oj.IsErroredOnProcessing) { res.status(502).json({ error: "ocr: " + (Array.isArray(oj.ErrorMessage) ? oj.ErrorMessage.join("; ") : (oj.ErrorMessage || "failed")) }); return; }
      const text = (oj.ParsedResults || []).map(p => p.ParsedText || "").join("\n");
      res.status(200).json({ ok: true, dates: extractDates(text), chars: text.length });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    return;
  }

  // ---- same-origin file bytes proxy ----
  const fileUrl = url.searchParams.get("file");
  if (fileUrl) {
    try {
      const { accessToken, GRAPH } = require("../lib/graph");
      const token = await accessToken();
      const r = await resolveDownloadUrl(token, GRAPH, fileUrl);
      if (r.error) { res.status(502).json({ error: r.error, detail: r.detail }); return; }
      const f = await fetch(r.dl);
      if (!f.ok) { res.status(502).json({ error: "download " + f.status }); return; }
      const buf = Buffer.from(await f.arrayBuffer());
      res.setHeader("Content-Type", (r.item.file && r.item.file.mimeType) || f.headers.get("content-type") || "application/octet-stream");
      res.status(200).send(buf);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  const tabs = (s.tabs && s.tabs.length) ? s.tabs : ["provider", "facility", "other"];
  let items = (data.items || []).filter(i => tabs.includes(i.scope));
  // Merge the live roster delta written by the hourly cron — surfaces Excel-roster changes
  // (additions / inactivations) without a code redeploy.
  try {
    const { accessToken, drivePath, readJsonAt } = require("../lib/graph");
    const token = await accessToken();
    const delta = await readJsonAt(token, drivePath("_Sentinel/roster_delta.json"));
    if (delta && tabs.includes("provider")) {
      const inactSet = new Set(delta.inactivated || []);
      const goneSet = new Set(delta.removed || []);
      // Mark inactivated providers; remove fully-removed ones.
      items = items.filter(i => !(i.scope === "provider" && goneSet.has(i.entityKey)));
      items.forEach(i => { if (i.scope === "provider" && inactSet.has(i.entityKey)) i.active = false; });
      // Append placeholder records for brand-new providers in the Excel.
      const CRED = [
        ["State Medical License","Texas Medical Board",90], ["Individual DEA Registration","DEA",60],
        ["ACLS Certification","AHA",60], ["ATLS Certification","ACS",60], ["PALS Certification","AHA",60],
        ["BLS Certification","AHA",60], ["Board Certification","Specialty Board",180],
        ["Driver's License","Texas DPS",30], ["Medical Diploma","Medical School",0],
        ["Influenza Vaccination","Employee Health",14], ["TB Screening","Employee Health",60],
        ["CME (20 hrs / 2 yrs)","TMB / CME",60], ["TSCA Documents","WCGTX",60],
        ["NPDB Query (2 yrs)","NPDB",60], ["OIG / SAM Exclusion Check","OIG",14],
        ["NPI Verification","NPPES",0], ["Initial Application","WCGTX",0],
        ["CV / Resume","WCGTX",0], ["Delineation of Privileges (DOP)","WCGTX",0],
        ["Peer References","WCGTX",0], ["Malpractice / COI Insurance","Carrier",60],
      ];
      const slug = (l, f) => (l + "-" + f).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
      const existingKeys = new Set(items.filter(i => i.scope === "provider").map(i => i.entityKey));
      (delta.newProviders || []).forEach(p => {
        const ekey = slug(p.last, p.first || "");
        if (existingKeys.has(ekey)) return;
        const entity = ((p.first || "") + " " + p.last).trim();
        CRED.forEach(([cat, auth, lead]) => {
          items.push({
            id: slug(ekey, cat), scope: "provider", entity, entityKey: ekey,
            category: cat, authority: auth, renewalLeadDays: lead,
            expires: null, pending: true, isFile: false, active: true,
            fileLink: null, folderLink: null, owner: entity,
            notes: "New provider — awaiting roster data + uploads",
            liveAdded: true,
          });
        });
      });
    }
  } catch (e) { /* roster delta is optional — failures shouldn't break /api/data */ }
  const keys = new Set(items.map(i => i.entityKey));
  const entityFiles = {};
  for (const k in (data.entityFiles || {})) if (keys.has(k)) entityFiles[k] = data.entityFiles[k];
  const contacts = tabs.includes("facility") ? (data.contacts || []) : [];
  res.status(200).json(Object.assign({}, data, { items, entityFiles, contacts, allowedTabs: tabs }));
};
