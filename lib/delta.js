// Apply roster_delta.json on top of the baked data.json items, so newly-added providers
// (added via the dashboard "+ Add provider" or by a new Provider/<Name>/ folder) appear
// immediately without a full Python regenerate. Shared by /api/data and /api/provider.
const { accessToken, drivePath, readJsonAt } = require("./graph");

function slug(l, f) { return (l + "-" + (f || "")).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase(); }
function spUrl(name) {
  return "https://wcgtx.sharepoint.com/sites/CorporateArchivesDirectory/Shared%20Documents/Sama%20Farooqui/Sentinel/Provider/"
    + name.split("/").map(encodeURIComponent).join("/");
}

const CRED = [
  ["State Medical License","Texas Medical Board",90], ["Individual DEA Registration","DEA",60],
  ["ACLS Certification","AHA",60], ["ATLS Certification","ACS",60], ["PALS Certification","AHA",60],
  ["BLS Certification","AHA",60], ["Board Certification","Specialty Board",180],
  ["Driver's License","Texas DPS",30], ["Medical Diploma","Medical School",0],
  ["Influenza Vaccination","Employee Health",14], ["TB Screening","Employee Health",60],
  ["CME (20 hrs / 2 yrs)","TMB / CME",60], ["TSCA Documents","WCGTX",60],
  ["NPDB Query (2 yrs)","NPDB",60], ["OIG / SAM Exclusion Check","OIG",14],
  ["NPI Verification","NPPES",0], ["Initial Application","WCGTX",0],
  ["CV / Resume","WCGTX",0], ["Delineation of Privileges (DOP)","WCGTX",0],
  ["Peer References","WCGTX",0], ["Malpractice / COI Insurance","Carrier",60],
];

async function applyRosterDelta(items) {
  let out = items.slice();
  try {
    const token = await accessToken();
    const delta = await readJsonAt(token, drivePath("_Sentinel/roster_delta.json"));
    if (!delta) return out;
    const inactSet = new Set(delta.inactivated || []);
    const goneSet = new Set(delta.removed || []);
    out = out.filter(i => !(i.scope === "provider" && goneSet.has(i.entityKey)));
    out.forEach(i => { if (i.scope === "provider" && inactSet.has(i.entityKey)) i.active = false; });
    const existingKeys = new Set(out.filter(i => i.scope === "provider").map(i => i.entityKey));
    (delta.newProviders || []).forEach(p => {
      const ekey = slug(p.last, p.first || "");
      if (existingKeys.has(ekey)) return;
      const entity = ((p.first || "") + " " + p.last).trim();
      const folder = spUrl(entity);
      CRED.forEach(([cat, auth, lead]) => {
        out.push({
          id: slug(ekey, cat), scope: "provider", entity, entityKey: ekey,
          category: cat, authority: auth, renewalLeadDays: lead,
          expires: null, pending: true, isFile: false, active: true,
          fileLink: folder, folderLink: folder, owner: entity,
          notes: "New provider — awaiting roster data + uploads",
          liveAdded: true,
        });
      });
    });
  } catch (e) { /* delta is optional; failures don't break the response */ }
  return out;
}

module.exports = { applyRosterDelta };
