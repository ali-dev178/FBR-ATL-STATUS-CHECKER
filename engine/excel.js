const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const fs = require('fs');

class OutputWorkbook {
  constructor(inputPath, outputPath, saveEvery = 10) {
    this.inputPath = inputPath;
    this.outputPath = outputPath;
    this.saveEvery = saveEvery;
    this.pendingWrites = []; // { excelRow, atlCol, status }
  }

  async init() {
    // Only copy if output doesn't exist (resume support)
    if (!fs.existsSync(this.outputPath)) {
      fs.copyFileSync(this.inputPath, this.outputPath);
    }
  }

  async getExistingResults(atlCol) {
    const existing = new Map();
    if (!fs.existsSync(this.outputPath)) return existing;

    // Use exceljs only for READING (it reads fine, just corrupts on write)
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(this.outputPath);
    const ws = wb.worksheets[0];

    ws.eachRow((row, rowNumber) => {
      const cell = row.getCell(atlCol + 1);
      const val = cell.value;
      if (val && String(val).trim() !== '') {
        existing.set(rowNumber, String(val).trim());
      }
    });

    return existing;
  }

  async writeStatus(excelRow, atlCol, status) {
    this.pendingWrites.push({ excelRow, atlCol, status });
    if (this.pendingWrites.length >= this.saveEvery) {
      await this.flush();
    }
  }

  async flush() {
    if (this.pendingWrites.length === 0) return 0;

    const writes = [...this.pendingWrites];
    this.pendingWrites = [];

    // Open the xlsx as a ZIP — only modify the sheet XML, preserve everything else
    const data = fs.readFileSync(this.outputPath);
    const zip = await JSZip.loadAsync(data);

    // Find the sheet XML (usually xl/worksheets/sheet1.xml)
    const sheetPath = 'xl/worksheets/sheet1.xml';
    let sheetXml = await zip.file(sheetPath).async('string');

    for (const { excelRow, atlCol, status } of writes) {
      const colLetter = colToLetter(atlCol);
      const cellRef = `${colLetter}${excelRow}`;

      // Find style index from an existing cell in this row to preserve borders/formatting
      const rowContentRegex = new RegExp(`<row r="${excelRow}"[^>]*?>(.*?)</row>`, 's');
      const rowContent = sheetXml.match(rowContentRegex);
      let styleAttr = '';
      if (rowContent) {
        // Pick the style from the last cell in the row (closest to our target column)
        const styleMatches = [...rowContent[1].matchAll(/<c [^>]*?s="(\d+)"[^>]*?/g)];
        if (styleMatches.length > 0) {
          styleAttr = ` s="${styleMatches[styleMatches.length - 1][1]}"`;
        }
      }

      const newCell = `<c r="${cellRef}"${styleAttr} t="str"><v>${escapeXml(status)}</v></c>`;

      // Check if cell already exists in sheet XML (handles both <c .../>  and <c ...>...</c>)
      const cellRegex = new RegExp(`<c r="${cellRef}".*?(?:/>|</c>)`, 's');

      if (cellRegex.test(sheetXml)) {
        // Replace existing cell
        sheetXml = sheetXml.replace(cellRegex, newCell);
      } else {
        // Insert cell into existing row — find the </row> for this row number
        const rowEndRegex = new RegExp(`(<row r="${excelRow}"[^>]*?>)(.*?)(</row>)`, 's');
        const rowMatch = sheetXml.match(rowEndRegex);

        if (rowMatch) {
          sheetXml = sheetXml.replace(rowEndRegex, `$1$2${newCell}$3`);
        } else {
          // Row doesn't exist — insert before </sheetData>
          const newRow = `<row r="${excelRow}">${newCell}</row>`;
          sheetXml = sheetXml.replace('</sheetData>', `${newRow}</sheetData>`);
        }
      }
    }

    // Save modified sheet XML back into ZIP
    zip.file(sheetPath, sheetXml);

    // Write ZIP back to disk
    const outputBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(this.outputPath, outputBuffer);

    return writes.length;
  }
}

function colToLetter(colIndex) {
  // 0-indexed column number to Excel letter (0=A, 1=B, ..., 25=Z, 26=AA)
  let letter = '';
  let n = colIndex;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { OutputWorkbook };
