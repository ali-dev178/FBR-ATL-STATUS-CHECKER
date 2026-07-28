#!/usr/bin/env node
/**
 * Regenerates examples/sample-input.xlsx — a small, safe demo workbook used by
 * the README, the screenshot harness, and anyone trying the app for the first
 * time.
 *
 * All names are fictional and all CNIC/NTN values are format-valid placeholders
 * that do not belong to any real taxpayer. They will come back as
 * "Record not exist" from the portal, which is the point: the file exercises
 * the whole pipeline without touching anyone's real data.
 *
 *   node scripts/generate-sample.js
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const ROWS = [
  ['Al-Noor Traders (Pvt) Ltd', '1111111'],
  ['Bright Star Enterprises', '3520100000001'],
  ['Chenab Textile Mills', '2222222'],
  ['Danish Hardware Store', '4210100000002'],
  ['Everest Logistics', '3333333'],
  ['Falcon Auto Parts', '3520100000003'],
  ['Gulberg Stationers', '4444444'],
  ['Hilal Foods Trading', '3740500000004'],
  ['Indus Paper Mart', '5555555'],
  ['Jasmine Packaging Co.', '3520100000005'],
  ['Karakoram Steel Works', '6666666'],
  ['Lahore Print House', '3520100000003'], // intentional duplicate — shows the cache
  ['Mehran Chemicals', '7777777'],
  ['Noor Electronics', '6110100000006'],
  ['Orient Furnishings', '8888888'],
  ['Pak Marble Traders', '3520100000007'],
  ['Quetta Dry Fruits', '9999999'],
  ['Ravi Plastics', '3310100000008'],
  ['Sialkot Sports Goods', '1010101'],
  ['Taj Mahal Sweets', '3520100000009'],
  ['Umar Farooq & Sons', '1212121'],
  ['Victory Tyres', '4230100000010'],
  ['Wah Cantt Suppliers', '1313131'],
  ['Xenon Lighting House', '3520100000011'],
  ['Zamzam Distributors', '1414141'],
];

const HEADERS = ['Sr', 'Buyer Name', 'CNIC/NTN', 'ATL Status'];

const aoa = [
  ['Sample Purchase Register — FY 2024-25'], // a title row above the header, to
  [],                                        // exercise header-row auto-detection
  HEADERS,
  ...ROWS.map(([name, id], i) => [i + 1, name, id, '']),
];

const ws = XLSX.utils.aoa_to_sheet(aoa);
ws['!cols'] = [{ wch: 5 }, { wch: 32 }, { wch: 18 }, { wch: 16 }];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Buyers');

const outDir = path.join(__dirname, '..', 'examples');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'sample-input.xlsx');
XLSX.writeFile(wb, outPath);

console.log(`examples/sample-input.xlsx   ${ROWS.length} rows`);
