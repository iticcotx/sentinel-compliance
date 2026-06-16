// Shared overlay (edits, notes, tasks, verify marks, watchlist, deletions) stored in
// OneDrive (_Sentinel/app_state.json) — replaces Supabase. Session-gated.
const { getSession } = require("../lib/session");
const { accessToken, readJsonAt, writeJsonAt, drivePath } = require("../lib/graph");
const PATH = drivePath("_Sentinel/app_state.json");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: "sign-in required" }); return; }
  try {
    const token = await accessToken();
    if (req.method === "GET") {
      res.status(200).json((await readJsonAt(token, PATH)) || {});
      return;
    }
    if (req.method === "POST") {
      let raw = ""; await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch (e) {}
      await writeJsonAt(token, PATH, body);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: "GET or POST only" });
  } catch (e) {
    res.status(200).json({ ok: false, message: String(e.message || e) });
  }
};
