#!/usr/bin/env node
/**
 * Renders assets/icon.svg into the raster icons electron-builder needs.
 *
 *   assets/icon.png   1024x1024  — electron-builder source icon (win/mac/linux)
 *   assets/icon.ico   multi-size — Windows window/taskbar icon
 *
 * Uses the Playwright Chromium that is already a project dependency, so there
 * is no extra image-processing dependency to install.
 *
 *   node scripts/generate-icons.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ASSETS = path.join(__dirname, '..', 'assets');
const SVG_PATH = path.join(ASSETS, 'icon.svg');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;background:transparent}
            svg{display:block;width:${size}px;height:${size}px}</style>
     ${svg}`,
    { waitUntil: 'load' }
  );
  return page.screenshot({ omitBackground: true });
}

/** Pack PNG buffers into a Windows .ico (PNG-compressed entries). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  const directory = Buffer.alloc(16 * pngs.length);
  let offset = header.length + directory.length;

  pngs.forEach(({ size, buffer }, i) => {
    const e = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, e + 0); // width  (0 == 256)
    directory.writeUInt8(size >= 256 ? 0 : size, e + 1); // height (0 == 256)
    directory.writeUInt8(0, e + 2); // palette colours
    directory.writeUInt8(0, e + 3); // reserved
    directory.writeUInt16LE(1, e + 4); // colour planes
    directory.writeUInt16LE(32, e + 6); // bits per pixel
    directory.writeUInt32LE(buffer.length, e + 8);
    directory.writeUInt32LE(offset, e + 12);
    offset += buffer.length;
  });

  return Buffer.concat([header, directory, ...pngs.map((p) => p.buffer)]);
}

(async () => {
  const svg = fs.readFileSync(SVG_PATH, 'utf-8');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    const master = await renderPng(page, svg, 1024);
    fs.writeFileSync(path.join(ASSETS, 'icon.png'), master);
    console.log('assets/icon.png       1024x1024');

    const pngs = [];
    for (const size of ICO_SIZES) {
      pngs.push({ size, buffer: await renderPng(page, svg, size) });
    }
    fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(pngs));
    console.log(`assets/icon.ico       ${ICO_SIZES.join(', ')}`);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
