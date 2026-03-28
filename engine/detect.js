const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

function detectType(value) {
  const clean = String(value).trim();
  const digitsOnly = clean.replace(/[^0-9]/g, '');
  if (digitsOnly.length === 13 && /^\d{13}$/.test(clean)) return 'CNIC';
  return 'NTN';
}

function autoDetectColumns(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const startRow = range.s.r;
  const allRows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });

  // Scan for header row containing CNIC/NTN
  let headerIdx = -1;
  let cnicCol = -1;
  let atlCol = -1;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').toLowerCase().trim();
      if (val.includes('cnic') || val.includes('ntn')) {
        headerIdx = i;
        cnicCol = c;
        break;
      }
    }
    if (headerIdx >= 0) break;
  }

  if (headerIdx < 0) {
    // Fallback: scan data for columns with CNIC/NTN-like values
    for (let c = 0; c < (allRows[0] || []).length; c++) {
      let cnicCount = 0;
      for (let i = 0; i < Math.min(allRows.length, 50); i++) {
        const val = String(allRows[i][c] || '').trim();
        if (/^\d{13}$/.test(val) || /^\d{5,8}$/.test(val) || /^[A-Z]\d{5,7}$/.test(val)) {
          cnicCount++;
        }
      }
      if (cnicCount >= 3) {
        headerIdx = 0; // assume first row is header or data starts at top
        cnicCol = c;
        break;
      }
    }
  }

  if (headerIdx < 0) return null;

  // Find ATL Status column
  const headerRow = allRows[headerIdx];
  // Only include columns that have a real header name (skip empty/hidden columns)
  const headers = [];
  for (let i = 0; i < headerRow.length; i++) {
    const name = String(headerRow[i] || '').trim();
    if (name) {
      headers.push({ index: i, name });
    }
  }

  for (let c = 0; c < headerRow.length; c++) {
    const val = String(headerRow[c] || '').toLowerCase().trim();
    if (val.includes('atl') || val.includes('status')) {
      atlCol = c;
      break;
    }
  }

  if (atlCol < 0) {
    atlCol = headerRow.length;
  }

  return { headerIdx, cnicCol, atlCol, startRow, headers, allRows };
}

async function getHiddenColumns(filePath) {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    const hidden = new Set();
    for (let c = 1; c <= 50; c++) {
      try {
        const col = ws.getColumn(c);
        if (col.hidden) hidden.add(c - 1); // exceljs is 1-indexed, we need 0-indexed
      } catch { break; }
    }
    return hidden;
  } catch {
    return new Set();
  }
}

async function generatePreview(filePath) {
  const detected = autoDetectColumns(filePath);
  if (!detected) {
    return { error: 'Could not find CNIC/NTN column in this file.' };
  }

  const { headerIdx, cnicCol, atlCol, startRow, headers: allHeaders, allRows } = detected;

  // Get hidden columns and filter them out of the dropdown
  const hiddenCols = await getHiddenColumns(filePath);
  const headers = allHeaders.filter(h => !hiddenCols.has(h.index));

  // Collect data rows
  const dataRows = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i];
    const srNo = row[0];
    const cnicNtn = String(row[cnicCol] || '').trim();
    if (!cnicNtn || (!Number.isFinite(srNo) && !/^\d+$/.test(String(srNo).trim()))) continue;
    const excelRow = i + startRow + 1;
    dataRows.push({ excelRow, srNo, buyerName: String(row[1] || '').trim(), cnicNtn, rowData: row });
  }

  // Count CNIC vs NTN
  let cnicCount = 0;
  let ntnCount = 0;
  const samples = [];
  const seenValues = new Set();

  for (const dr of dataRows) {
    const type = detectType(dr.cnicNtn);
    if (type === 'CNIC') cnicCount++;
    else ntnCount++;

    if (!seenValues.has(dr.cnicNtn) && samples.length < 5) {
      samples.push({ value: dr.cnicNtn, type, name: dr.buyerName, srNo: dr.srNo });
      seenValues.add(dr.cnicNtn);
    }
  }

  const uniqueValues = new Set(dataRows.map(r => r.cnicNtn)).size;

  return {
    filePath,
    sheetName: XLSX.readFile(filePath).SheetNames[0],
    totalRows: dataRows.length,
    uniqueValues,
    duplicates: dataRows.length - uniqueValues,
    cnicCount,
    ntnCount,
    samples,
    headers,
    detectedCnicCol: cnicCol,
    detectedAtlCol: atlCol,
    headerIdx,
    startRow,
    previewRows: dataRows.slice(0, 8).map(r => ({
      srNo: r.srNo,
      buyerName: r.buyerName,
      cnicNtn: r.cnicNtn,
      type: detectType(r.cnicNtn),
    })),
  };
}

function readInputRows(filePath, cnicCol, atlCol) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const startRow = range.s.r;
  const allRows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });

  // Find header row
  let headerIdx = -1;
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').toLowerCase().trim();
      if (val.includes('cnic') || val.includes('ntn') || c === cnicCol) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx >= 0) break;
  }

  if (headerIdx < 0) headerIdx = 0;

  const dataRows = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i];
    const srNo = row[0];
    const cnicNtn = String(row[cnicCol] || '').trim();
    if (!cnicNtn || (!Number.isFinite(srNo) && !/^\d+$/.test(String(srNo).trim()))) continue;
    const excelRow = i + startRow + 1;
    dataRows.push({ excelRow, srNo, buyerName: String(row[1] || '').trim(), cnicNtn });
  }

  return { dataRows, atlCol };
}

module.exports = { detectType, autoDetectColumns, generatePreview, readInputRows };
