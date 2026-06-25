// Public, minimal endpoint for the provider self-service portal: returns ONLY the
// requested provider's items (never the whole roster), plus the item's siblings for
// the upload dropdown. Used by provider.html and upload.html (no login needed).
const data = require("../data.json");
const { applyRosterDelta } = require("../lib/delta");

function slim(i) {
  return { id: i.id, category: i.category, authority: i.authority, expires: i.expires, isFile: i.isFile, folderLink: i.folderLink || i.fileLink, entity: i.entity, entityKey: i.entityKey };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const u = new URL(req.url, "http://localhost");
  const e = u.searchParams.get("e");
  const id = u.searchParams.get("item");
  // Apply the live roster delta so providers added via the dashboard show up here
  // (no full Python regenerate needed for the QR upload page to recognize them).
  const allItems = await applyRosterDelta(data.items || []);
  let ekey = e;
  let current = null;
  if (id) { current = allItems.find(i => i.id === id) || null; if (current) ekey = current.entityKey; }
  if (!ekey) { res.status(400).json({ error: "missing e or item" }); return; }
  const items = allItems.filter(i => i.entityKey === ekey).map(slim);
  res.status(200).json({ entity: items[0] ? items[0].entity : "", items, current: current ? slim(current) : null });
};
