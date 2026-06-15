// Signed session cookie for Microsoft-authenticated staff.
// HMAC-signed with MS_CLIENT_SECRET (already a server-only secret) — no new env var.
// Cookie is httpOnly + Secure, so client JS / F12 cannot read or forge it.
const crypto = require("crypto");
const SECRET = process.env.SESSION_SECRET || process.env.MS_CLIENT_SECRET || "dev-only";
const COOKIE = "sentinel_session";

function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64url(s) { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); }

function sign(obj) {
  const p = b64url(JSON.stringify(obj));
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(p).digest());
  return p + "." + sig;
}
function verify(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [p, sig] = token.split(".");
  const expect = b64url(crypto.createHmac("sha256", SECRET).update(p).digest());
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try { const o = JSON.parse(unb64url(p)); if (o.exp && Date.now() > o.exp) return null; return o; } catch (e) { return null; }
}
function parseCookies(req) {
  const h = req.headers.cookie || ""; const o = {};
  h.split(";").forEach(c => { const i = c.indexOf("="); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return o;
}
function getSession(req) { return verify(parseCookies(req)[COOKIE]); }
function cookieHeader(token, maxAgeSec) {
  return COOKIE + "=" + token + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + maxAgeSec;
}
function clearHeader() { return COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"; }

module.exports = { sign, verify, getSession, cookieHeader, clearHeader, COOKIE };
