// Kicks off the one-time Microsoft sign-in. Sama opens this URL, signs in,
// approves, and Microsoft redirects to /api/auth-callback with a code.
const { authorizeUrl, CLIENT_ID } = require("../lib/graph");

module.exports = async (req, res) => {
  if (!CLIENT_ID) { res.status(500).send("MS_CLIENT_ID is not set in Vercel env vars yet."); return; }
  res.writeHead(302, { Location: authorizeUrl() });
  res.end();
};
