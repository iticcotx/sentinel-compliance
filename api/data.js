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
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: "sign-in required" }); return; }
  const url = new URL(req.url, "http://localhost");

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
  const items = (data.items || []).filter(i => tabs.includes(i.scope));
  const keys = new Set(items.map(i => i.entityKey));
  const entityFiles = {};
  for (const k in (data.entityFiles || {})) if (keys.has(k)) entityFiles[k] = data.entityFiles[k];
  const contacts = tabs.includes("facility") ? (data.contacts || []) : [];
  res.status(200).json(Object.assign({}, data, { items, entityFiles, contacts, allowedTabs: tabs }));
};
