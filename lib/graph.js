// ============================================================================
// Microsoft Graph helpers for Sentinel — delegated (per-user) refresh-token flow.
// Secrets come ONLY from Vercel env vars (never committed to this public repo):
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REFRESH_TOKEN
// Sama signs in once (/api/auth-start) to mint MS_REFRESH_TOKEN; the server then
// uploads files into HER OneDrive as her, into each provider's existing folder.
// ============================================================================
const TENANT = process.env.MS_TENANT_ID;
const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.MS_REFRESH_TOKEN;
const REDIRECT_URI = process.env.MS_REDIRECT_URI ||
  "https://sentinel-compliance-kappa.vercel.app/api/auth-callback";

// Delegated scopes. offline_access => we get a refresh token.
const SCOPES = "offline_access Files.ReadWrite.All User.Read";

// Sama's OneDrive root (/me/drive/root) maps to /personal/.../Documents/.
// All Sentinel files live under this one subfolder of that root:
const ROOT = "WCGTX Phyicians_04.08.2020";

const AUTH = "https://login.microsoftonline.com/" + (TENANT || "common") + "/oauth2/v2.0";

function authorizeUrl() {
  const p = new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", redirect_uri: REDIRECT_URI,
    response_mode: "query", scope: SCOPES, prompt: "consent"
  });
  return AUTH + "/authorize?" + p.toString();
}

async function postToken(params) {
  const r = await fetch(AUTH + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString()
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || ("token HTTP " + r.status));
  return j;
}

// One-time: turn the ?code from the sign-in into tokens (incl. refresh_token).
function exchangeCode(code) {
  return postToken({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code",
    code, redirect_uri: REDIRECT_URI, scope: SCOPES
  });
}

// Every request: trade the stored refresh token for a fresh access token.
async function accessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("MS_CLIENT_ID / MS_CLIENT_SECRET not set in Vercel env.");
  if (!REFRESH_TOKEN) throw new Error("MS_REFRESH_TOKEN not set — Sama must sign in once at /api/auth-start.");
  const j = await postToken({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token",
    refresh_token: REFRESH_TOKEN, scope: SCOPES
  });
  return j.access_token;
}

// Build the path under /me/drive/root for a provider/facility folder-relative path.
// Input may be a dashboard fileLink/folderLink like "../..WCGTX Master Physician File/...".
function drivePath(rel) {
  const clean = String(rel || "").replace(/^(\.\.\/)+/, "").replace(/^\/+|\/+$/g, "");
  return ROOT + (clean ? "/" + clean : "");
}

// URL-encode each path segment for Graph's root:/<path>:/ addressing.
function encPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

const GRAPH = "https://graph.microsoft.com/v1.0";

module.exports = {
  TENANT, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, REDIRECT_URI, SCOPES, ROOT, GRAPH,
  authorizeUrl, exchangeCode, accessToken, drivePath, encPath
};
