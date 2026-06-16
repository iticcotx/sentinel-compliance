// The roster — served ONLY to a signed-in staff member, and FILTERED to the tabs
// they're allowed. Data for a tab a user can't access never leaves the server.
const { getSession } = require("../lib/session");
const data = require("../data.json");

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: "sign-in required" }); return; }

  const tabs = (s.tabs && s.tabs.length) ? s.tabs : ["provider", "facility", "other"];
  const items = (data.items || []).filter(i => tabs.includes(i.scope));
  const keys = new Set(items.map(i => i.entityKey));
  const entityFiles = {};
  for (const k in (data.entityFiles || {})) if (keys.has(k)) entityFiles[k] = data.entityFiles[k];
  const contacts = tabs.includes("facility") ? (data.contacts || []) : [];

  res.status(200).json(Object.assign({}, data, { items, entityFiles, contacts, allowedTabs: tabs }));
};
