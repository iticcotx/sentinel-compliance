// Manage who can sign in and which tabs they get. Admin-only.
// GET -> { users:[{email,tabs,admin}], me, admin }
// POST { action:"save", email, tabs:[...], admin? }  or  { action:"remove", email }
const { getSession } = require("../lib/session");
const { getUsers, setUsers, findUser, ALL_TABS, OWNER } = require("../lib/access");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: "sign-in required" }); return; }

  if (req.method === "GET") {
    res.status(200).json({ users: await getUsers(), me: s.email, admin: !!s.admin });
    return;
  }
  if (req.method === "POST") {
    if (!s.admin) { res.status(403).json({ error: "admins only" }); return; }
    let raw = ""; await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
    let b = {}; try { b = JSON.parse(raw || "{}"); } catch (e) {}
    const email = String(b.email || "").trim().toLowerCase();
    if (!email || email.indexOf("@") < 0) { res.status(400).json({ error: "valid email required" }); return; }
    let users = await getUsers();
    if (b.action === "remove") {
      if (email === OWNER) { res.status(400).json({ error: "can’t remove the owner account" }); return; }
      users = users.filter(u => u.email !== email);
    } else if (b.action === "save") {
      const tabs = Array.isArray(b.tabs) ? b.tabs.filter(t => ALL_TABS.includes(t)) : [];
      if (!tabs.length) { res.status(400).json({ error: "select at least one tab" }); return; }
      const existing = findUser(email, users);
      const admin = (email === OWNER) ? true : (existing ? !!b.admin : !!b.admin);
      if (existing) { existing.tabs = tabs; existing.admin = admin; }
      else users.push({ email, tabs, admin });
    } else { res.status(400).json({ error: "action must be save or remove" }); return; }
    if (!users.some(u => u.email === OWNER)) users.push({ email: OWNER, tabs: ALL_TABS.slice(), admin: true });
    await setUsers(users);
    res.status(200).json({ ok: true, users });
    return;
  }
  res.status(405).json({ error: "GET or POST only" });
};
