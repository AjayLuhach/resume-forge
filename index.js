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
import { generateDocx } from './services/document.js';
import { convertToPdf, cleanupDocx, checkLibreOffice } from './services/converter.js';

// Dynamic import based on provider
async function getAIService() {
  const provider = config.ai.provider;
  if (provider === 'bedrock') {
    const module = await import('./services/ai-bedrock.js');
    return module.tailorResume;
  }
  // Default to Gemini
  const module = await import('./services/ai.js');
  return module.tailorResume;
}

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
  const provider = config.ai.provider;

  // Provider-specific checks
  const aiCheck = provider === 'bedrock'
    ? {
        name: `AWS Bedrock (${config.ai.bedrock.modelId.split('.')[1]?.split('-').slice(0,3).join('-') || 'claude'})`,
        pass: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
        required: true,
      }
    : {
        name: 'Gemini API Key',
        pass: !!config.ai.geminiApiKey,
        required: true,
      };

  const checks = [
    aiCheck,
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
function displaySummary(aiResponse, resumeData) {
  console.log('\n' + '═'.repeat(60));
  console.log('📋 GENERATED CONTENT');
  console.log('═'.repeat(60));

  console.log('\n🏷️  TITLE:');
  console.log(aiResponse.title || 'Full Stack Developer (MERN)');

  console.log('\n📝 SUMMARY:');
  console.log(aiResponse.summary);

  console.log('\n🎯 SKILLS:');
  console.log(aiResponse.skills);

  console.log('\n📌 BULLETS:');
  aiResponse.bullets.forEach((b, i) => console.log(`${i + 1}. ${b}`));

  console.log('\n🚀 PERSONAL PROJECTS:');
  // Display personal projects dynamically from resumeData
  (resumeData.projects || []).forEach(project => {
    const key = project.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    console.log(`${project.name}: ${aiResponse[key] || ''}`);
  });

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

    // AI tailoring (dynamic provider)
    const tailorResume = await getAIService();
    console.log(`\n🤖 Using AI provider: ${config.ai.provider.toUpperCase()}`);
    const aiResponse = await tailorResume(jobDescription, resumeData);

    // Preview
    displaySummary(aiResponse, resumeData);

    // Get output paths (Name_Role.pdf - replaces same file each run)
    const userName = resumeData.personalInfo?.name || 'Resume';
    const jobRole = 'MERN-Developer'
    const outputPaths = config.paths.getOutputPaths(userName, jobRole);
    console.log(`📁 Output: ${outputPaths.pdf}`);

    // Generate DOCX
    const docxPath = await generateDocx(aiResponse, outputPaths, resumeData);

    // Convert to PDF if LibreOffice available
    let outputPath = docxPath;

    if (hasLibreOffice) {
      outputPath = await convertToPdf(docxPath, outputPaths.pdf);
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
