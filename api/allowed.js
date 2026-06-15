// Manage who can sign in. GET lists the allowlist; POST adds/removes an email.
// Session-protected: only an already-signed-in (allowed) staff member can change it.
const { getSession } = require("../lib/session");
const { getAllowed, setAllowed } = require("../lib/access");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: "sign-in required" }); return; }

  if (req.method === "GET") { res.status(200).json({ emails: await getAllowed(), me: s.email }); return; }

  if (req.method === "POST") {
    let raw = ""; await new Promise(r => { req.on("data", c => raw += c); req.on("end", r); });
    let b = {}; try { b = JSON.parse(raw || "{}"); } catch (e) {}
    const email = String(b.email || "").trim().toLowerCase();
    if (!email || email.indexOf("@") < 0) { res.status(400).json({ error: "valid email required" }); return; }
    let list = await getAllowed();
    if (b.action === "add") { if (!list.some(x => x.toLowerCase() === email)) list.push(email); }
    else if (b.action === "remove") { list = list.filter(x => x.toLowerCase() !== email); }
    else { res.status(400).json({ error: "action must be add or remove" }); return; }
    if (!list.length) list = ["iaijaz@wcgtx.com"]; // never lock everyone out
    await setAllowed(list);
    res.status(200).json({ ok: true, emails: list });
    return;
  }
  res.status(405).json({ error: "GET or POST only" });
};
