/**
 * Configuration for resume-forge CLI
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const config = {
  // Paths
  paths: {
    resumeData: join(__dirname, 'resumeData.json'),
    template: join(__dirname, 'template.docx'),
    outputDocx: join(__dirname, 'resume.docx'),
    outputPdf: join(__dirname, 'resume.pdf'),
  },

  // AI Configuration
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    model: 'gemini-2.5-flash',
  },

  // Output options
  output: {
    // Set to false to skip PDF conversion and keep DOCX only
    convertToPdf: true,
  },

  // LibreOffice path (only needed if convertToPdf is true)
  libreOffice: {
    command: 'libreoffice',
  },
};

export default config;
