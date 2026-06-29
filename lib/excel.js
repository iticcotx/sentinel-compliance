// Master physician roster — read/write via download-edit-upload with `exceljs`.
// We avoid Microsoft Graph's /workbook API because it goes through Office Online (WAC) and
// app-only credentials hit "Could not obtain a WAC access token" on this OneDrive. exceljs runs
// purely in-memory on Vercel's Node runtime — no Office services involved.
const ExcelJS = require("exceljs");
const { accessToken, encPath, GRAPH } = require("./graph");

// The master roster moved during the 2026-06 OneDrive reorg: the old "Compliance" folder was
// archived to "..ZCompliance" and the live master now lives under "..WCGTX Master Rosters".
// Env-overridable so a future move is a Vercel env change, not a code deploy.
const ROSTER_PATH = process.env.MS_ROSTER_PATH ||
  "WCGTX Phyicians_04.08.2020/..WCGTX Master Rosters/WCGTX Physician Roster.xlsx";
const SHEET_ACTIVE = "WCGTX Credentials";
const SHEET_INACTIVE = "Inactive Providers";
const DRIVE_ID = process.env.MS_DRIVE_ID || "b!hICmGNzaFEiC8Z6vebrpNWzB937MR0tFsLlTxA2x3Z9-nxsW_blJTrLUhaL3IsBm";

function rosterRoot() { return GRAPH + "/drives/" + DRIVE_ID + "/root:/" + encPath(ROSTER_PATH); }
// Pull plain text out of any exceljs cell value (string, number, {text}, {richText:[{text}]}, {result}, Date, etc.)
function cellText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map(r => r && r.text ? r.text : "").join("");
    if (typeof v.text === "string") return v.text;
    if (typeof v.result === "string" || typeof v.result === "number") return String(v.result);
    if (typeof v.formula === "string") return "";
  }
  return String(v);
}
function normName(s) { return cellText(s).replace(/[\*,()]+/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }

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
  // 1st pass: exact last-name + first-name (or prefix). Sheet schema: col A = last, col B = first.
  for (let r = 2; r <= ws.rowCount; r++) {
    const last = normName(ws.getRow(r).getCell(1).value);
    const first = normName(ws.getRow(r).getCell(2).value);
    if (last && last === tLast && (!tFirst || first === tFirst || first.startsWith(tFirst) || tFirst.startsWith(first))) return r;
  }
  // 2nd pass: maybe columns are swapped in this row (some entries are typed "First, Last").
  for (let r = 2; r <= ws.rowCount; r++) {
    const a = normName(ws.getRow(r).getCell(1).value);
    const b = normName(ws.getRow(r).getCell(2).value);
    if (a === tFirst && b === tLast) return r;
  }
  // 3rd pass: last-name only when first name didn't match — handles roster typos / suffixes.
  if (tLast) {
    for (let r = 2; r <= ws.rowCount; r++) {
      const last = normName(ws.getRow(r).getCell(1).value);
      if (last === tLast) return r;
    }
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

// Slug a (last, first) pair the same way generate_data.py and the JS dashboard do, so we
// can find an Excel row by the dashboard's entityKey without guessing how to split a display name.
function slugKey(last, first) {
  return (String(last || "") + "-" + String(first || ""))
    .replace(/[\*,()]+/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
async function findRowByEntityKey(token, sheetName, entityKey) {
  const wb = await downloadWorkbook(token);
  const ws = getSheet(wb, sheetName);
  for (let r = 2; r <= ws.rowCount; r++) {
    const last = cellText(ws.getRow(r).getCell(1).value).replace(/[\*,()]+/g, "").trim();
    const first = cellText(ws.getRow(r).getCell(2).value).trim();
    if (!last) continue;
    if (slugKey(last, first) === entityKey) return { rowIndex: r, last, first };
  }
  return null;
}
async function findByEntityKeyAnywhere(token, entityKey) {
  const a = await findRowByEntityKey(token, SHEET_ACTIVE, entityKey);
  if (a) return { sheet: SHEET_ACTIVE, ...a };
  const i = await findRowByEntityKey(token, SHEET_INACTIVE, entityKey);
  if (i) return { sheet: SHEET_INACTIVE, ...i };
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

// HARD DELETE: remove rows matching entityKey (or last/first) from BOTH Credentials and
// Inactive sheets in one download-upload cycle. Returns the deleted rows' values for
// logging into the recycle bin so they can be restored.
async function hardDelete(token, entityKey, lastName, firstName) {
  const wb = await downloadWorkbook(token);
  const removed = [];
  for (const sheetName of [SHEET_ACTIVE, SHEET_INACTIVE]) {
    const ws = getSheet(wb, sheetName);
    let matched = [];
    // Find ALL matching rows (handle multiple — shouldn't happen but be defensive).
    for (let r = ws.rowCount; r >= 2; r--) {   // iterate top-down indices, delete bottom-up
      const last = cellText(ws.getRow(r).getCell(1).value).replace(/[\*,()]+/g, "").trim();
      const first = cellText(ws.getRow(r).getCell(2).value).trim();
      if (!last) continue;
      const ek = (last + "-" + (first || "")).replace(/[\*,()]+/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
      const matchByKey = entityKey && ek === entityKey;
      const matchByName = lastName && normName(last) === normName(lastName) && (!firstName || normName(first) === normName(firstName));
      if (matchByKey || matchByName) matched.push(r);
    }
    matched.sort((a, b) => b - a);   // descending so spliceRows doesn't shift indices we need
    for (const r of matched) {
      const row = ws.getRow(r);
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(row.getCell(c).value));
      removed.push({ sheet: sheetName, rowIndex: r, values: vals });
      ws.spliceRows(r, 1);
    }
  }
  if (removed.length) await uploadWorkbook(token, wb);
  return removed;
}

// Restore a single trashed row back to the Credentials sheet.
async function restoreRow(token, sheetName, values) {
  const wb = await downloadWorkbook(token);
  const ws = getSheet(wb, sheetName || SHEET_ACTIVE);
  ws.addRow(values);
  await uploadWorkbook(token, wb);
}

// Backup the current workbook to _Sentinel/roster_backups/.
// Returns { ok, method, name } on success or { ok:false, error } on failure so callers
// can surface the actual reason instead of a silent false.
async function snapshotWorkbook(token, label) {
  const ts = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
  const name = "Roster_" + ts + "_" + (label || "auto") + ".xlsx";
  try {
    const { ensureFolder } = require("./graph");
    // Graph's content-PUT doesn't reliably create intermediate folders on this drive;
    // create the backups folder explicitly so the first ever backup works.
    await ensureFolder(token, "_Sentinel/roster_backups");

    // Prefer server-side copy (no download/upload bytes, works at any file size).
    const copyR = await fetch(rosterRoot() + ":/copy", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        parentReference: { driveId: DRIVE_ID, path: "/drives/" + DRIVE_ID + "/root:/_Sentinel/roster_backups" },
        name
      })
    });
    if (copyR.ok || copyR.status === 202) return { ok: true, method: "copy", name };
    const copyText = await copyR.text();

    // Copy failed — fall back to download/upload PUT (works for files < ~4MB).
    const dl = await fetch(rosterRoot() + ":/content", { headers: { Authorization: "Bearer " + token } });
    if (!dl.ok) return { ok: false, error: "copy " + copyR.status + " then download " + dl.status, detail: copyText.slice(0, 160) };
    const buf = Buffer.from(await dl.arrayBuffer());
    const path = "_Sentinel/roster_backups/" + name;
    const up = await fetch(GRAPH + "/drives/" + DRIVE_ID + "/root:/" + encPath(path) + ":/content", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body: buf
    });
    if (!up.ok) {
      const upText = await up.text();
      return { ok: false, error: "copy " + copyR.status + ", put " + up.status, detail: upText.slice(0, 160), sizeBytes: buf.length };
    }
    return { ok: true, method: "put", name, sizeBytes: buf.length };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200), name }; }
}

module.exports = {
  ROSTER_PATH, SHEET_ACTIVE, SHEET_INACTIVE,
  readSheet, appendRow, deleteRow, moveRow, findRow, findAnywhere,
  findRowByEntityKey, findByEntityKeyAnywhere,
  hardDelete, restoreRow, snapshotWorkbook
};
