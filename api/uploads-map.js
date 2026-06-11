// The item_id -> uploaded-document map, stored as a small JSON file IN OneDrive
// (_Sentinel/uploads.json) — no Supabase. GET returns it; POST adds one entry.
// Only QR-uploaded docs live here; the 3,000+ pre-matched docs get their links
// built client-side from data.json, so this file stays tiny.
const { accessToken, drivePath, encPath, GRAPH } = require("../lib/graph");

const MAP_PATH = drivePath("_Sentinel/uploads.json");

async function readMap(token) {
  const r = await fetch(`${GRAPH}/me/drive/root:/${encPath(MAP_PATH)}:/content`, {
    headers: { Authorization: "Bearer " + token }
  });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error("read map HTTP " + r.status);
  return await r.json().catch(() => ({}));
}

async function writeMap(token, map) {
  const r = await fetch(`${GRAPH}/me/drive/root:/${encPath(MAP_PATH)}:/content`, {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(map)
  });
  if (!r.ok) throw new Error("write map HTTP " + r.status);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const token = await accessToken();
    if (req.method === "GET") { res.status(200).json(await readMap(token)); return; }
    if (req.method === "POST") {
      let raw = ""; await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
      let b = {}; try { b = JSON.parse(raw || "{}"); } catch (e) {}
      if (!b.item_id || !b.url) { res.status(400).json({ ok: false, message: "need item_id and url" }); return; }
      const map = await readMap(token);
      map[b.item_id] = { url: b.url, name: b.name || "" };
      await writeMap(token, map);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ ok: false, message: "GET or POST only" });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
