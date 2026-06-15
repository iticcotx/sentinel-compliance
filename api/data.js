// The full roster — served ONLY to a signed-in staff member. This is what makes the
// data safe: it never ships to the browser until the Microsoft session is verified.
const { getSession } = require("../lib/session");
const data = require("../data.json");
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!getSession(req)) { res.status(401).json({ error: "sign-in required" }); return; }
  res.status(200).json(data);
};
