// Opens a Microsoft Graph upload session in the item's OneDrive folder (app-only).
// The browser then PUTs the file bytes straight to the returned uploadUrl, so large
// phone photos never hit Vercel's request-size limit.
const { accessToken, drivePath, encPath, driveRoot, ensureFolder } = require("../lib/graph");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const url = new URL(req.url, "http://localhost");
    const folder = url.searchParams.get("folder") || "";
    const name = (url.searchParams.get("name") || "upload.bin").replace(/[^A-Za-z0-9 ._-]/g, "_");
    if (!folder) { res.status(400).json({ ok: false, message: "missing folder" }); return; }

    const token = await accessToken();
    const folderPath = drivePath(folder);
    await ensureFolder(token, folderPath);
    const filePath = folderPath + "/Sentinel_Upload_" + name;
    const r = await fetch(driveRoot() + "/root:/" + encPath(filePath) + ":/createUploadSession", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ("Graph HTTP " + r.status));
    res.status(200).json({ ok: true, uploadUrl: j.uploadUrl, path: filePath });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
