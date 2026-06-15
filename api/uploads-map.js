// What the dashboard reads to show attached documents. Merges:
//   _Sentinel/auto_detected.json  (files dropped straight into OneDrive — from /api/scan)
//   _Sentinel/uploads.json        (files sent via the QR upload page — these win)
// GET returns the merged map; POST adds a QR-upload entry. All app-only, no Supabase.
const { accessToken, readJsonAt, writeJsonAt, drivePath } = require("../lib/graph");

const UPLOADS = drivePath("_Sentinel/uploads.json");
const DETECTED = drivePath("_Sentinel/auto_detected.json");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const token = await accessToken();
    if (req.method === "GET") {
      const [detected, uploads] = await Promise.all([readJsonAt(token, DETECTED), readJsonAt(token, UPLOADS)]);
      res.status(200).json(Object.assign({}, detected || {}, uploads || {}));
      return;
    }
    if (req.method === "POST") {
      let raw = ""; await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
      let b = {}; try { b = JSON.parse(raw || "{}"); } catch (e) {}
      if (!b.item_id || !b.url) { res.status(400).json({ ok: false, message: "need item_id and url" }); return; }
      const map = (await readJsonAt(token, UPLOADS)) || {};
      map[b.item_id] = { url: b.url, name: b.name || "" };
      await writeJsonAt(token, UPLOADS, map);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ ok: false, message: "GET or POST only" });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
