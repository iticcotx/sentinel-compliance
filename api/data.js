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
      const { accessToken, docsRoot, docsPathFromUrl, encPath } = require("../lib/graph");
      const path = docsPathFromUrl(fileUrl);
      if (!path) { res.status(400).json({ error: "unrecognized file url" }); return; }
      const token = await accessToken();
      const r = await fetch(docsRoot() + "/root:/" + encPath(path) + ":/content", { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) { res.status(r.status).json({ error: "fetch failed " + r.status }); return; }
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
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
