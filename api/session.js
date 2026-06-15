// Is the current visitor a signed-in staff member?
const { getSession } = require("../lib/session");
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const s = getSession(req);
  if (!s) { res.status(401).json({ authed: false }); return; }
  res.status(200).json({ authed: true, email: s.email, name: s.name });
};
