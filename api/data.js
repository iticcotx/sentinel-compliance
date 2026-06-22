// The roster — served ONLY to a signed-in staff member, and FILTERED to the tabs
// they're allowed. Data for a tab a user can't access never leaves the server.
// Also doubles as a same-origin file-bytes proxy (?file=<sharepoint url>) so the browser
// can run OCR on a Sentinel document without hitting cross-origin/CORS walls.
const { getSession } = require("../lib/session");
const data = require("../data.json");

module.exports = async (req, res) => {
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: "sign-in required" }); return; }

  const url = new URL(req.url, "http://localhost");
  const fileUrl = url.searchParams.get("file");
  if (fileUrl) {
    try {
      const { accessToken, GRAPH } = require("../lib/graph");
      const token = await accessToken();
      // Resolve ANY SharePoint URL to its driveItem via the /shares endpoint (no path/drive guessing).
      const shareId = "u!" + Buffer.from(fileUrl, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
      const di = await fetch(GRAPH + "/shares/" + shareId + "/driveItem", { headers: { Authorization: "Bearer " + token } });
      if (!di.ok) { res.status(502).json({ error: "resolve " + di.status, detail: (await di.text()).slice(0, 200) }); return; }
      const item = await di.json();
      const dl = item["@microsoft.graph.downloadUrl"] || item["@content.downloadUrl"];
      if (!dl) { res.status(502).json({ error: "no download url for item" }); return; }
      const f = await fetch(dl);
      if (!f.ok) { res.status(502).json({ error: "download " + f.status }); return; }
      const buf = Buffer.from(await f.arrayBuffer());
      res.setHeader("Content-Type", (item.file && item.file.mimeType) || f.headers.get("content-type") || "application/octet-stream");
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
