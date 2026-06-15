// Access allowlist — ONLY these emails may sign in (even within the wcgtx tenant).
// Stored in OneDrive (_Sentinel/allowed.json) so it can be managed without redeploys.
// Defaults to just the owner so the dashboard is locked down until people are added.
const { accessToken, readJsonAt, writeJsonAt, drivePath } = require("./graph");
const PATH = drivePath("_Sentinel/allowed.json");
const DEFAULT = ["iaijaz@wcgtx.com"];

async function getAllowed() {
  try {
    const token = await accessToken();
    const j = await readJsonAt(token, PATH);
    const arr = (j && Array.isArray(j.emails)) ? j.emails.filter(Boolean) : null;
    return (arr && arr.length) ? arr : DEFAULT.slice();
  } catch (e) { return DEFAULT.slice(); }
}
async function setAllowed(list) {
  const token = await accessToken();
  await writeJsonAt(token, PATH, { emails: list });
}
function isAllowed(email, list) {
  const e = String(email || "").toLowerCase();
  return list.some(x => String(x).toLowerCase() === e);
}
module.exports = { getAllowed, setAllowed, isAllowed, DEFAULT };
