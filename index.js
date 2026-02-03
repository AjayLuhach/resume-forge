#!/usr/bin/env node

/**
 * Resume Forge CLI
 *
 * Automatically tailors your resume based on job descriptions using AI.
 *
 * Usage:
 *   1. Copy a job description to your clipboard
 *   2. Run: node index.js (or npm start)
 *   3. Get a tailored resume (DOCX or PDF)
 */

import fs from 'fs';
import config from './config.js';
import { readClipboard, validateJobDescription } from './services/clipboard.js';
import { tailorResume } from './services/ai.js';
import { generateDocx } from './services/document.js';
import { convertToPdf, cleanupDocx, checkLibreOffice } from './services/converter.js';

/**
 * Load master resume data from JSON file
 */
function loadResumeData() {
  console.log('📂 Loading master resume data...');

  if (!fs.existsSync(config.paths.resumeData)) {
    throw new Error(`Resume data not found: ${config.paths.resumeData}`);
  }

  const data = JSON.parse(fs.readFileSync(config.paths.resumeData, 'utf-8'));
  console.log(`✅ Loaded: ${data.personalInfo?.name}`);

  return data;
}

/**
 * Pre-flight checks
 */
function preflightChecks() {
  console.log('\n🔍 Pre-flight checks...\n');

  const hasLibreOffice = checkLibreOffice();

  const checks = [
    {
      name: 'Gemini API Key',
      pass: !!config.ai.geminiApiKey,
      required: true,
    },
    {
      name: 'Resume Data',
      pass: fs.existsSync(config.paths.resumeData),
      required: true,
    },
    {
      name: 'Template',
      pass: fs.existsSync(config.paths.template),
      required: true,
    },
    {
      name: 'LibreOffice (for PDF)',
      pass: hasLibreOffice,
      required: false, // Optional - will output DOCX if not available
    },
  ];

  const failures = [];

  for (const { name, pass, required } of checks) {
    if (pass) {
      console.log(`   ✅ ${name}`);
    } else if (required) {
      console.log(`   ❌ ${name}`);
      failures.push(name);
    } else {
      console.log(`   ⚠️  ${name} (optional - will output DOCX only)`);
    }
  }

  console.log('');

  if (failures.length > 0) {
    throw new Error(`Missing required: ${failures.join(', ')}`);
  }

  return { hasLibreOffice };
}

/**
 * Display generated content preview
 */
function displaySummary(aiResponse) {
  console.log('\n' + '═'.repeat(60));
  console.log('📋 GENERATED CONTENT');
  console.log('═'.repeat(60));

  console.log('\n📝 SUMMARY:');
  console.log(aiResponse.summary);

  console.log('\n🎯 SKILLS:');
  console.log(aiResponse.skills);

  console.log('\n📌 BULLETS:');
  aiResponse.bullets.forEach((b, i) => console.log(`${i + 1}. ${b}`));

  console.log('\n' + '═'.repeat(60) + '\n');
}

/**
 * Main
 */
async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              🎯 RESUME FORGE CLI                        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n');

  try {
    // Pre-flight
    const { hasLibreOffice } = preflightChecks();

    // Read clipboard
    const jobDescription = await readClipboard();
    validateJobDescription(jobDescription);

    // Load resume data
    const resumeData = loadResumeData();

    // AI tailoring
    const aiResponse = await tailorResume(jobDescription, resumeData);

    // Preview
    displaySummary(aiResponse);

    // Generate DOCX
    const docxPath = await generateDocx(aiResponse);

    // Convert to PDF if LibreOffice available
    let outputPath = docxPath;

    if (hasLibreOffice) {
      outputPath = await convertToPdf(docxPath);
      cleanupDocx(docxPath);
    } else {
      console.log('📄 LibreOffice not found - keeping DOCX output');
    }

    // Done
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ SUCCESS!                           ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`\n📄 Output: ${outputPath}\n`);

  } catch (error) {
    console.error('\n');
    console.error('╔══════════════════════════════════════════════════════════╗');
    console.error('║                    ❌ ERROR                              ║');
    console.error('╚══════════════════════════════════════════════════════════╝');
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}

main();
