/**
 * Configuration for resume-forge CLI
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Output directory for resumes
const outputDir = join(homedir(), 'Music');

// Find next available resume number
function getNextResumeNumber() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    return 1;
  }

  const files = fs.readdirSync(outputDir);
  const resumeNumbers = files
    .filter(f => f.match(/^resume_(\d+)\.pdf$/))
    .map(f => parseInt(f.match(/^resume_(\d+)\.pdf$/)[1]));

  return resumeNumbers.length > 0 ? Math.max(...resumeNumbers) + 1 : 1;
}

export const config = {
  // Paths
  paths: {
    resumeData: join(__dirname, 'resumeData.json'),
    template: join(__dirname, 'template.docx'),
    outputDir: outputDir,
    getOutputPaths: () => {
      const num = getNextResumeNumber();
      return {
        docx: join(outputDir, `resume_${num}.docx`),
        pdf: join(outputDir, `resume_${num}.pdf`),
      };
    },
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
