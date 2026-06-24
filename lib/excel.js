// Master physician roster — read/write via download-edit-upload with `exceljs`.
// We avoid Microsoft Graph's /workbook API because it goes through Office Online (WAC) and
// app-only credentials hit "Could not obtain a WAC access token" on this OneDrive. exceljs runs
// purely in-memory on Vercel's Node runtime — no Office services involved.
const ExcelJS = require("exceljs");
const { accessToken, encPath, GRAPH } = require("./graph");

const ROSTER_PATH = "WCGTX Phyicians_04.08.2020/Compliance/WCGTX Physician Roster.xlsx";
const SHEET_ACTIVE = "WCGTX Credentials";
const SHEET_INACTIVE = "Inactive Providers";
const DRIVE_ID = process.env.MS_DRIVE_ID || "b!hICmGNzaFEiC8Z6vebrpNWzB937MR0tFsLlTxA2x3Z9-nxsW_blJTrLUhaL3IsBm";

function rosterRoot() { return GRAPH + "/drives/" + DRIVE_ID + "/root:/" + encPath(ROSTER_PATH); }
function normName(s) { return String(s || "").replace(/[\*,()]+/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }

async function downloadWorkbook(token) {
  const r = await fetch(rosterRoot() + ":/content", { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("download roster: " + r.status + " " + (await r.text()).slice(0, 200));
  const buf = Buffer.from(await r.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

async function uploadWorkbook(token, wb) {
  const buf = await wb.xlsx.writeBuffer();
  // Files this size (~few MB) upload fine in a single PUT.
  const r = await fetch(rosterRoot() + ":/content", {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    body: buf
  });
  if (!r.ok) throw new Error("upload roster: " + r.status + " " + (await r.text()).slice(0, 200));
}

function getSheet(wb, name) {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error("sheet not found: " + name);
  return ws;
}

// readSheet returns { values, rowCount, columnCount } — same shape as the old workbook-API caller expected.
async function readSheet(token, sheetName) {
  const wb = await downloadWorkbook(token);
  const ws = getSheet(wb, sheetName);
  const values = [];
  let maxCol = 0;
  ws.eachRow({ includeEmpty: true }, (row) => {
    const arr = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = row.getCell(c).value;
      arr.push(v == null ? null : (typeof v === "object" && v.text ? v.text : v));
    }
    if (arr.length > maxCol) maxCol = arr.length;
    values.push(arr);
  });
  return { values, rowCount: values.length, columnCount: maxCol };
}

function _findRowIndex(ws, lastName, firstName) {
  const tLast = normName(lastName), tFirst = normName(firstName);
  for (let r = 2; r <= ws.rowCount; r++) {
    const last = normName(ws.getRow(r).getCell(1).value);
    const first = normName(ws.getRow(r).getCell(2).value);
    if (last && last === tLast && (!tFirst || first === tFirst || first.startsWith(tFirst))) return r;
  }
  return null;
}

async function findRow(token, sheetName, lastName, firstName) {
  const wb = await downloadWorkbook(token);
  const ws = getSheet(wb, sheetName);
  const idx = _findRowIndex(ws, lastName, firstName);
  if (!idx) return null;
  const arr = [];
  for (let c = 1; c <= ws.columnCount; c++) arr.push(ws.getRow(idx).getCell(c).value);
  return { rowIndex: idx, values: arr };
}

async function findAnywhere(token, lastName, firstName) {
  const wb = await downloadWorkbook(token);
  const ai = _findRowIndex(getSheet(wb, SHEET_ACTIVE), lastName, firstName);
  if (ai) return { sheet: SHEET_ACTIVE, rowIndex: ai };
  const ii = _findRowIndex(getSheet(wb, SHEET_INACTIVE), lastName, firstName);
  if (ii) return { sheet: SHEET_INACTIVE, rowIndex: ii };
  return null;
}

async function appendRow(token, sheetName, rowValues) {
  const wb = await downloadWorkbook(token);
  const ws = getSheet(wb, sheetName);
  const newRow = ws.addRow(rowValues);
  await uploadWorkbook(token, wb);
  return { rowIndex: newRow.number };
}

async function deleteRow(token, sheetName, rowIndex) {
  const wb = await downloadWorkbook(token);
  const ws = getSheet(wb, sheetName);
  ws.spliceRows(rowIndex, 1);
  await uploadWorkbook(token, wb);
}

// Move a row between sheets in ONE download-upload cycle (atomic).
async function moveRow(token, fromSheet, fromRowIndex, toSheet) {
  const wb = await downloadWorkbook(token);
  const src = getSheet(wb, fromSheet);
  const dst = getSheet(wb, toSheet);
  const row = src.getRow(fromRowIndex);
  const vals = [];
  for (let c = 1; c <= src.columnCount; c++) vals.push(row.getCell(c).value);
  dst.addRow(vals);
  src.spliceRows(fromRowIndex, 1);
  await uploadWorkbook(token, wb);
}

// Backup the current workbook by copying its bytes to _Sentinel/roster_backups/.
async function snapshotWorkbook(token, label) {
  try {
    const r = await fetch(rosterRoot() + ":/content", { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    const ts = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
    const name = "Roster_" + ts + "_" + (label || "auto") + ".xlsx";
    const path = "_Sentinel/roster_backups/" + name;
    const up = await fetch(GRAPH + "/drives/" + DRIVE_ID + "/root:/" + encPath(path) + ":/content", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body: buf
    });
    return up.ok;
  } catch (e) { return false; }
}

module.exports = {
  ROSTER_PATH, SHEET_ACTIVE, SHEET_INACTIVE,
  readSheet, appendRow, deleteRow, moveRow, findRow, findAnywhere, snapshotWorkbook
};
