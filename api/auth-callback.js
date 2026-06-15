// Microsoft redirects here after staff sign-in. We exchange the code, read the
// id_token (came straight from Microsoft over TLS, so trusted), verify the user is
// in OUR tenant, then set a signed session cookie and send them to the dashboard.
const { sign, cookieHeader } = require("../lib/session");
const { getAllowed, isAllowed } = require("../lib/access");

function esc(s) { return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:system-ui,Segoe UI,Arial;max-width:520px;margin:48px auto;padding:0 18px;color:#0f172a">
<h2 style="color:#0f766e">${title}</h2>${body}<p><a href="/api/auth-login">Try sign-in again</a></p></body>`;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (err || !code) { res.setHeader("Content-Type", "text/html"); res.status(200).send(page("Sign-in didn’t complete", "<p>" + (err || "No authorization code returned.") + "</p>")); return; }

  const tenant = process.env.MS_TENANT_ID, cid = process.env.MS_CLIENT_ID, sec = process.env.MS_CLIENT_SECRET;
  const redirect = "https://sentinel-compliance-kappa.vercel.app/api/auth-callback";
  try {
    const r = await fetch("https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: "authorization_code", code, redirect_uri: redirect, scope: "openid profile email User.Read" }).toString()
    });
    const j = await r.json();
    if (!j.id_token) throw new Error(j.error_description || "no id_token");
    const claims = JSON.parse(Buffer.from(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (claims.tid !== tenant) { res.setHeader("Content-Type", "text/html"); res.status(403).send(page("Access denied", "<p>That account isn’t part of Wellness &amp; Care Group of Texas.</p>")); return; }
    const email = claims.preferred_username || claims.email || claims.upn || "staff";
    // Allowlist: even within wcgtx, only approved people may enter.
    const allowed = await getAllowed();
    if (!isAllowed(email, allowed)) {
      res.setHeader("Content-Type", "text/html");
      res.status(403).send(page("Not authorized", "<p><b>" + esc(email) + "</b> isn’t on the access list for this dashboard.</p><p>Ask the administrator (Imad) to add you, then try again.</p>"));
      return;
    }
    const token = sign({ email, name: claims.name || email, exp: Date.now() + 1000 * 60 * 60 * 12 }); // 12 hours
    res.setHeader("Set-Cookie", cookieHeader(token, 60 * 60 * 12));
    res.writeHead(302, { Location: "/" });
    res.end();
  } catch (e) {
    res.setHeader("Content-Type", "text/html");
    res.status(200).send(page("Sign-in problem", "<p>" + String(e.message || e) + "</p>"));
  }
};
