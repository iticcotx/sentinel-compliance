// Microsoft Graph Workbook helpers for the master physician roster.
// Writes to: WCGTX Phyicians_04.08.2020/Compliance/WCGTX Physician Roster.xlsx (in the OneDrive
// app-state drive — the roster has stayed on the personal OneDrive even after the source-of-truth
// migration, so we use DRIVE_ID, not DOCS_DRIVE_ID).
// All writes snapshot the workbook to _Sentinel/roster_backups/ first so a bad write can be reversed.
const { accessToken, encPath, GRAPH, drivePath } = require("./graph");

const ROSTER_PATH = "WCGTX Phyicians_04.08.2020/Compliance/WCGTX Physician Roster.xlsx";
const SHEET_ACTIVE = "WCGTX Credentials";
const SHEET_INACTIVE = "Inactive Providers";
const DRIVE_ID = process.env.MS_DRIVE_ID || "b!hICmGNzaFEiC8Z6vebrpNWzB937MR0tFsLlTxA2x3Z9-nxsW_blJTrLUhaL3IsBm";

function rosterRoot() { return GRAPH + "/drives/" + DRIVE_ID + "/root:/" + encPath(ROSTER_PATH); }
function workbookEndpoint() { return rosterRoot() + ":/workbook"; }
function colLetter(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s || "A";
}
function normName(s) { return String(s || "").replace(/[\*,()]+/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }

async function readSheet(token, sheetName) {
  const url = workbookEndpoint() + "/worksheets('" + encodeURIComponent(sheetName) + "')/usedRange?$select=values,rowCount,columnCount,address";
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("readSheet " + sheetName + ": " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();   // { values, rowCount, columnCount, address }
}

async function appendRow(token, sheetName, rowValues) {
  const used = await readSheet(token, sheetName);
  const nextRow = (used.rowCount || 0) + 1;
  const cols = Math.max(rowValues.length, used.columnCount || rowValues.length);
  const padded = rowValues.slice();
  while (padded.length < cols) padded.push(null);
  const address = "A" + nextRow + ":" + colLetter(cols) + nextRow;
  const url = workbookEndpoint() + "/worksheets('" + encodeURIComponent(sheetName) + "')/range(address='" + address + "')";
  const r = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [padded] })
  });
  if (!r.ok) throw new Error("appendRow: " + r.status + " " + (await r.text()).slice(0, 200));
  return { rowIndex: nextRow, columns: cols };
}

// Find the 1-based row index in a sheet whose first two columns match the given last + first name.
// Returns null if no match.
async function findRow(token, sheetName, lastName, firstName) {
  const used = await readSheet(token, sheetName);
  const values = used.values || [];
  const targetLast = normName(lastName);
  const targetFirst = normName(firstName);
  for (let i = 1; i < values.length; i++) {   // skip header
    const last = normName(values[i][0]);
    const first = normName(values[i][1]);
    if (last && last === targetLast && (!targetFirst || first === targetFirst || first.startsWith(targetFirst))) {
      return { rowIndex: i + 1, values: values[i] };
    }
  }
  return null;
}

async function deleteRow(token, sheetName, rowIndex) {
  const used = await readSheet(token, sheetName);
  const lastCol = colLetter(Math.max(used.columnCount || 26, 26));
  const address = "A" + rowIndex + ":" + lastCol + rowIndex;
  const url = workbookEndpoint() + "/worksheets('" + encodeURIComponent(sheetName) + "')/range(address='" + address + "')/delete";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ shift: "Up" })
  });
  if (!r.ok) throw new Error("deleteRow: " + r.status + " " + (await r.text()).slice(0, 200));
}

// Move a row from one sheet to another (used to deactivate a provider: Credentials -> Inactive).
async function moveRow(token, fromSheet, fromRowIndex, toSheet) {
  const used = await readSheet(token, fromSheet);
  const rowVals = (used.values || [])[fromRowIndex - 1] || [];
  await appendRow(token, toSheet, rowVals);
  await deleteRow(token, fromSheet, fromRowIndex);
}

// Quick check: is this name already in either sheet? Prevents double-adding.
async function findAnywhere(token, lastName, firstName) {
  const a = await findRow(token, SHEET_ACTIVE, lastName, firstName);
  if (a) return { sheet: SHEET_ACTIVE, ...a };
  const i = await findRow(token, SHEET_INACTIVE, lastName, firstName);
  if (i) return { sheet: SHEET_INACTIVE, ...i };
  return null;
}

// Snapshot the whole workbook to a backups folder before any destructive write.
async function snapshotWorkbook(token, label) {
  const ts = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
  const name = "Roster_" + ts + "_" + (label || "auto") + ".xlsx";
  const url = rosterRoot() + ":/copy";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ parentReference: { driveId: DRIVE_ID, path: "/drive/root:/" + drivePath("_Sentinel/roster_backups").replace("_Sentinel", "_Sentinel") }, name })
  });
  return r.ok || r.status === 202;   // 202 Accepted = async copy in progress
}

module.exports = {
  ROSTER_PATH, SHEET_ACTIVE, SHEET_INACTIVE,
  readSheet, appendRow, deleteRow, moveRow, findRow, findAnywhere, snapshotWorkbook
};
