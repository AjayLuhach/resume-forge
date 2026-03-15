/**
 * Converter Service - DOCX to PDF conversion
 *
 * Supports two conversion backends (auto-detected):
 *   1. Puppeteer (Chrome/Chromium) - primary, no extra install needed if Chrome exists
 *   2. LibreOffice - fallback, requires `libreoffice` in PATH
 *
 * If neither is available, outputs DOCX only with a warning.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import config from "../../config.js";

// ── Detection ──

/**
 * Check if LibreOffice is available
 */
export function checkLibreOffice() {
  try {
    execSync(`${config.libreOffice.command} --version`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find system Chrome/Chromium executable
 * @returns {string|null} path to Chrome or null
 */
function findChrome() {
  const candidates = [
    // Linux
    "google-chrome",
    "google-chrome-stable",
    "chromium-browser",
    "chromium",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // Windows (common paths)
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];

  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" --version`, {
        stdio: "pipe",
        encoding: "utf-8",
      });
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Check if Puppeteer + Chrome is available for PDF conversion
 */
export async function checkPuppeteer() {
  try {
    await import("puppeteer-core");
    return !!findChrome();
  } catch {
    return false;
  }
}

/**
 * Check if any PDF converter is available
 */
export function checkPdfConverter() {
  return !!findChrome() || checkLibreOffice();
}

// ── Puppeteer Conversion ──

/**
 * Convert DOCX to PDF using mammoth (DOCX→HTML) + Puppeteer (HTML→PDF)
 */
async function convertWithPuppeteer(docxPath, targetPdfPath) {
  const mammoth = await import("mammoth");
  const puppeteer = await import("puppeteer-core");

  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome/Chromium not found for Puppeteer conversion");
  }

  // Step 1: DOCX → HTML via mammoth
  const docxBuffer = fs.readFileSync(docxPath);
  const { value: html } = await mammoth.default.convertToHtml({
    buffer: docxBuffer,
  });

  // Wrap in a styled HTML document for professional output
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { margin: 0.6in 0.7in; size: letter; }
    body {
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #333;
      max-width: 100%;
    }
    h1 { font-size: 18pt; margin: 0 0 4pt; color: #1a1a1a; }
    h2 { font-size: 13pt; margin: 12pt 0 4pt; color: #2c3e50; border-bottom: 1px solid #bdc3c7; padding-bottom: 2pt; }
    h3 { font-size: 11pt; margin: 8pt 0 2pt; }
    p { margin: 2pt 0; }
    ul { margin: 2pt 0; padding-left: 18pt; }
    li { margin: 1pt 0; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 2pt 4pt; }
    strong { color: #1a1a1a; }
  </style>
</head>
<body>${html}</body>
</html>`;

  // Step 2: HTML → PDF via Puppeteer
  const browser = await puppeteer.default.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });
    await page.pdf({
      path: targetPdfPath,
      format: "Letter",
      printBackground: true,
      margin: { top: "0.6in", bottom: "0.6in", left: "0.7in", right: "0.7in" },
    });
  } finally {
    await browser.close();
  }

  return targetPdfPath;
}

// ── LibreOffice Conversion ──

/**
 * Convert DOCX to PDF using LibreOffice headless mode
 */
async function convertWithLibreOffice(docxPath, targetPdfPath) {
  const outputDir = path.dirname(docxPath);
  const docxBasename = path.basename(docxPath, ".docx");

  const command = `${config.libreOffice.command} --headless --convert-to pdf --outdir "${outputDir}" "${docxPath}"`;
  console.log(`   Running: ${command}`);

  execSync(command, {
    stdio: "pipe",
    encoding: "utf-8",
    timeout: 60000,
  });

  const generatedPdf = path.join(outputDir, `${docxBasename}.pdf`);
  if (generatedPdf !== targetPdfPath) {
    fs.renameSync(generatedPdf, targetPdfPath);
  }

  return targetPdfPath;
}

// ── Public API ──

/**
 * Convert DOCX to PDF using the best available backend
 * Priority: Puppeteer (Chrome) → LibreOffice → Error
 *
 * @param {string} docxPath - Path to input DOCX file
 * @param {string} targetPdfPath - Desired output PDF path
 * @returns {Promise<string>} Path to generated PDF file
 */
export async function convertToPdf(docxPath, targetPdfPath) {
  console.log("🔄 Converting DOCX to PDF...");

  if (!fs.existsSync(docxPath)) {
    throw new Error(`DOCX file not found: ${docxPath}`);
  }

  // Try Puppeteer first (Chrome-based, no extra install)
  const chromePath = findChrome();
  if (chromePath) {
    try {
      console.log("   Using: Chrome (via Puppeteer)");
      await convertWithPuppeteer(docxPath, targetPdfPath);
      console.log(`✅ PDF saved: ${targetPdfPath}`);
      return targetPdfPath;
    } catch (error) {
      console.warn(`⚠️  Puppeteer conversion failed: ${error.message}`);
      console.warn("   Falling back to LibreOffice...");
    }
  }

  // Fallback to LibreOffice
  if (checkLibreOffice()) {
    console.log("   Using: LibreOffice");
    await convertWithLibreOffice(docxPath, targetPdfPath);
    console.log(`✅ PDF saved: ${targetPdfPath}`);
    return targetPdfPath;
  }

  throw new Error(
    "No PDF converter available.\n" +
      "Install one of:\n" +
      "  - Google Chrome (recommended, usually already installed)\n" +
      "  - LibreOffice: sudo apt install libreoffice (Linux) | brew install --cask libreoffice (macOS)",
  );
}

/**
 * Clean up temporary DOCX file after conversion
 */
export function cleanupDocx(docxPath) {
  console.log("🧹 Cleaning up temporary DOCX file...");
  try {
    if (fs.existsSync(docxPath)) {
      fs.unlinkSync(docxPath);
      console.log(`✅ Deleted: ${docxPath}`);
    }
  } catch (error) {
    console.warn(`⚠️  Could not delete DOCX file: ${error.message}`);
  }
}

export default { convertToPdf, cleanupDocx, checkLibreOffice, checkPdfConverter };
