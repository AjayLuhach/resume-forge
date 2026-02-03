/**
 * Converter Service - Handles DOCX to PDF conversion using LibreOffice
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import config from '../config.js';

/**
 * Check if LibreOffice is available
 * @returns {boolean} Whether LibreOffice is installed
 */
export function checkLibreOffice() {
  try {
    execSync(`${config.libreOffice.command} --version`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert DOCX to PDF using LibreOffice headless mode
 * @param {string} docxPath - Path to input DOCX file
 * @returns {Promise<string>} Path to generated PDF file
 */
export async function convertToPdf(docxPath) {
  console.log('🔄 Converting DOCX to PDF using LibreOffice...');

  if (!fs.existsSync(docxPath)) {
    throw new Error(`DOCX file not found: ${docxPath}`);
  }

  if (!checkLibreOffice()) {
    throw new Error(
      'LibreOffice is not installed or not in PATH.\n' +
      'Install it using:\n' +
      '  - Ubuntu/Debian: sudo apt install libreoffice\n' +
      '  - macOS: brew install --cask libreoffice\n' +
      '  - Windows: Download from https://www.libreoffice.org/download/'
    );
  }

  const outputDir = path.dirname(docxPath);
  const docxBasename = path.basename(docxPath, '.docx');

  try {
    // Run LibreOffice in headless mode
    const command = `${config.libreOffice.command} --headless --convert-to pdf --outdir "${outputDir}" "${docxPath}"`;

    console.log(`   Running: ${command}`);

    execSync(command, {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000, // 60 second timeout
    });

    // LibreOffice creates PDF with same basename
    const generatedPdf = path.join(outputDir, `${docxBasename}.pdf`);

    // Rename to our target filename if different
    if (generatedPdf !== config.paths.outputPdf) {
      if (fs.existsSync(config.paths.outputPdf)) {
        fs.unlinkSync(config.paths.outputPdf);
      }
      fs.renameSync(generatedPdf, config.paths.outputPdf);
    }

    console.log(`✅ PDF saved: ${config.paths.outputPdf}`);

    return config.paths.outputPdf;
  } catch (error) {
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
}

/**
 * Clean up temporary DOCX file after conversion
 * @param {string} docxPath - Path to DOCX file to delete
 */
export function cleanupDocx(docxPath) {
  console.log('🧹 Cleaning up temporary DOCX file...');

  try {
    if (fs.existsSync(docxPath)) {
      fs.unlinkSync(docxPath);
      console.log(`✅ Deleted: ${docxPath}`);
    }
  } catch (error) {
    console.warn(`⚠️  Could not delete DOCX file: ${error.message}`);
  }
}

export default { convertToPdf, cleanupDocx, checkLibreOffice };
