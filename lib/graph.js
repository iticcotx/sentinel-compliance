// ============================================================================
// Microsoft Graph helpers for Sentinel — APP-ONLY (client credentials).
// The app authenticates as itself (no user sign-in) and writes into the OneDrive
// where all the credential files live. Sama left the company, so there is no user
// to sign in; app-only access via the drive ID is the correct, durable approach.
// Secrets come ONLY from Vercel env vars: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET.
// Requires the app to have the *Application* permission Files.ReadWrite.All (admin-consented).
// ============================================================================
const TENANT = process.env.MS_TENANT_ID;
const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;

// Sama's OneDrive (sfarooqui@wcgtx.com — where WCGTX Phyicians_04.08.2020 and all the
// real credential files live). Verified via app-only write. Not secret; env-overridable.
const DRIVE_ID = process.env.MS_DRIVE_ID ||
  "b!hICmGNzaFEiC8Z6vebrpNWzB937MR0tFsLlTxA2x3Z9-nxsW_blJTrLUhaL3IsBm";
// Files live under this single subfolder of that drive's root.
const ROOT = "WCGTX Phyicians_04.08.2020";
const GRAPH = "https://graph.microsoft.com/v1.0";

async function accessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || !TENANT) throw new Error("MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET not set in Vercel env.");
  const r = await fetch("https://login.microsoftonline.com/" + TENANT + "/oauth2/v2.0/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }).toString()
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || ("token HTTP " + r.status));
  return j.access_token;
}

function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
function driveRoot() { return GRAPH + "/drives/" + DRIVE_ID; }

// Map a dashboard fileLink/folderLink ("../..WCGTX Master Physician File/...") to a
// path under the drive root (prefixed with ROOT).
function drivePath(rel) {
  const clean = String(rel || "").replace(/^(\.\.\/)+/, "").replace(/^\/+|\/+$/g, "");
  return ROOT + (clean ? "/" + clean : "");
}

// Make sure every folder in a path exists (createUploadSession needs the parent to exist).
async function ensureFolder(token, folderPath) {
  const parts = String(folderPath).split("/").filter(Boolean);
  let parent = "";
  for (const name of parts) {
    const target = parent === "" ? driveRoot() + "/root/children" : driveRoot() + "/root:/" + encPath(parent) + ":/children";
    const res = await fetch(target, {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
    });
    if (!res.ok && res.status !== 409) {
      const t = await res.text();
      if (!/nameAlreadyExists|already exists/i.test(t)) throw new Error("ensureFolder '" + name + "' HTTP " + res.status + " " + t.slice(0, 160));
    }
    parent = parent === "" ? name : parent + "/" + name;
  }
}

// Read a JSON file from the drive (null if missing).
async function readJsonAt(token, path) {
  const r = await fetch(driveRoot() + "/root:/" + encPath(path) + ":/content", { headers: { Authorization: "Bearer " + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("read " + path + " HTTP " + r.status);
  return await r.json().catch(() => null);
}
// Write a JSON file to the drive (creates parent folders).
async function writeJsonAt(token, path, obj) {
  const parent = path.split("/").slice(0, -1).join("/");
  if (parent) await ensureFolder(token, parent);
  const r = await fetch(driveRoot() + "/root:/" + encPath(path) + ":/content", {
    method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error("write " + path + " HTTP " + r.status);
}

// Extract an expiry date from a filename like "ACLS_09_18_2026.pdf" -> latest valid date as YYYY-MM-DD.
function dateFromName(name) {
  let best = null, m;
  const re = /(\d{1,2})[_.\-](\d{1,2})[_.\-](\d{2,4})/g;
  while ((m = re.exec(String(name || "")))) {
    let mo = +m[1], d = +m[2], y = +m[3]; if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const iso = y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      if (!best || iso > best) best = iso;
    }
  }
  return best;
}

module.exports = { TENANT, CLIENT_ID, CLIENT_SECRET, DRIVE_ID, ROOT, GRAPH, accessToken, encPath, driveRoot, drivePath, ensureFolder, readJsonAt, writeJsonAt, dateFromName };
