const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

function detectType(value) {
  const clean = String(value).trim();
  const digitsOnly = clean.replace(/[^0-9]/g, '');
  if (digitsOnly.length === 13 && /^\d{13}$/.test(clean)) return 'CNIC';
  return 'NTN';
}

// Detect Sr No column from header row
function detectSrCol(headerRow) {
  for (let c = 0; c < headerRow.length; c++) {
    const val = String(headerRow[c] || '').toLowerCase().trim();
    if (val === 'sr' || val === 'sr.' || val === 'sr.no' || val === 'sr.no.' ||
        val === 's.no' || val === 's.no.' || val === 'sno' || val === '#' ||
        val === 'no' || val === 'no.' || val === 'serial' || val === 'row') {
      return c;
    }
  }
  return -1;
}

// Detect Name/Buyer column from header row
function detectNameCol(headerRow) {
  for (let c = 0; c < headerRow.length; c++) {
    const val = String(headerRow[c] || '').toLowerCase().trim();
    if (val.includes('name') || val.includes('buyer') || val.includes('company') ||
        val.includes('taxpayer') || val.includes('organization') || val.includes('entity')) {
      return c;
    }
  }
  return -1;
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
      for (let i = 0; i < Math.min(allRows.length, 100); i++) {
        const val = String(allRows[i][c] || '').trim();
        if (/^\d{13}$/.test(val) || /^\d{5,8}$/.test(val) || /^[A-Z]\d{5,7}$/.test(val)) {
          cnicCount++;
        }
      }
      if (cnicCount >= 3) {
        headerIdx = 0;
        cnicCol = c;
        break;
      }
    }
  }

  if (headerIdx < 0) return null;

  const headerRow = allRows[headerIdx];

  // Detect Sr No and Name columns dynamically
  const srCol = detectSrCol(headerRow);
  const nameCol = detectNameCol(headerRow);

  // Only include columns that have a real header name
  const headers = [];
  for (let i = 0; i < headerRow.length; i++) {
    const name = String(headerRow[i] || '').trim();
    if (name) {
      headers.push({ index: i, name });
    }
  }

  // Find ATL Status column
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

  return { headerIdx, cnicCol, atlCol, srCol, nameCol, startRow, headers, allRows };
}

async function getHiddenColumns(filePath) {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    const hidden = new Set();
    const colCount = ws.columnCount || 200;
    for (let c = 1; c <= colCount; c++) {
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

  const { headerIdx, cnicCol, atlCol, srCol, nameCol, startRow, headers: allHeaders, allRows } = detected;

  // Get hidden columns and filter them out of the dropdown
  const hiddenCols = await getHiddenColumns(filePath);
  const headers = allHeaders.filter(h => !hiddenCols.has(h.index));

  // Collect data rows
  const totalSheetRows = allRows.length - (headerIdx + 1);
  let emptyRows = 0;
  const dataRows = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i];
    const cnicNtn = String(row[cnicCol] || '').trim();

    // Skip rows with empty CNIC/NTN
    if (!cnicNtn) {
      emptyRows++;
      continue;
    }

    // If we have a Sr column, skip rows where it's empty (likely sub-headers or footers)
    if (srCol >= 0) {
      const srVal = row[srCol];
      if (!Number.isFinite(srVal) && !/^\d+$/.test(String(srVal || '').trim())) {
        emptyRows++;
        continue;
      }
    }

    const excelRow = i + startRow + 1;
    const srNo = srCol >= 0 ? row[srCol] : (i - headerIdx);
    const buyerName = nameCol >= 0 ? String(row[nameCol] || '').trim() : '';

    dataRows.push({ excelRow, srNo, buyerName, cnicNtn, rowData: row });
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

  // Count non-empty values per column (for "already done" based on write column)
  const columnFillCounts = {};
  for (const h of allHeaders) {
    let count = 0;
    for (const dr of dataRows) {
      const val = String(dr.rowData[h.index] || '').trim();
      if (val) count++;
    }
    columnFillCounts[h.index] = count;
  }
  // Also count for the detected ATL column (might be a new column with 0 fills)
  if (!(atlCol in columnFillCounts)) {
    columnFillCounts[atlCol] = 0;
  }

  return {
    filePath,
    sheetName: XLSX.readFile(filePath).SheetNames[0],
    totalSheetRows,
    totalRows: dataRows.length,
    emptyRows,
    uniqueValues,
    duplicates: dataRows.length - uniqueValues,
    cnicCount,
    ntnCount,
    columnFillCounts,
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

  // Find the header row exactly the way the preview did. Detecting it a second
  // time here used to treat any row with a cell at the read-column index as the
  // header, which matched a title row sitting above the real header — the
  // header itself then got processed as a data row and its label overwritten.
  const detected = autoDetectColumns(filePath);
  const headerIdx = detected ? detected.headerIdx : 0;

  const headerRow = allRows[headerIdx] || [];
  const srCol = detectSrCol(headerRow);
  const nameCol = detectNameCol(headerRow);

  const dataRows = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i];
    const cnicNtn = String(row[cnicCol] || '').trim();

    // Skip rows with empty CNIC/NTN
    if (!cnicNtn) continue;

    // If we have a Sr column, skip rows where it's empty
    if (srCol >= 0) {
      const srVal = row[srCol];
      if (!Number.isFinite(srVal) && !/^\d+$/.test(String(srVal || '').trim())) continue;
    }

    const excelRow = i + startRow + 1;
    const srNo = srCol >= 0 ? row[srCol] : (i - headerIdx);
    const buyerName = nameCol >= 0 ? String(row[nameCol] || '').trim() : '';

    dataRows.push({ excelRow, srNo, buyerName, cnicNtn });
  }

  return { dataRows, atlCol };
}

module.exports = { detectType, autoDetectColumns, generatePreview, readInputRows };
