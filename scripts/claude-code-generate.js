#!/usr/bin/env node

/**
 * Claude Code Resume Pipeline Script
 *
 * This script takes the AI-generated analysis and rewrite JSON
 * (produced by Claude Code itself) and runs the remaining pipeline:
 *   - ATS scoring (deterministic)
 *   - DOCX generation from template
 *   - PDF conversion via LibreOffice
 *   - Email & LinkedIn DM generation
 *   - All logging (contacts, resume history, keyword gaps, costs)
 *
 * Usage:
 *   node scripts/claude-code-generate.js <path-to-pipeline-input.json>
 *
 * The input JSON file must have this structure:
 * {
 *   "analysis": { ... },   // Expanded analysis object (Step 1 output)
 *   "rewrite": { ... }     // Expanded rewrite object (Step 2 output)
 * }
 */

import fs from "fs";
import config from "../config.js";
import { scoreResume } from "../services/pipeline/ats-scorer.js";
import { generateDocx } from "../services/pipeline/document.js";
import { convertToPdf, cleanupDocx, checkLibreOffice } from "../services/pipeline/converter.js";
import { generateEmail, generateLinkedInDM } from "../services/outreach/email-generator.js";
import {
  logContactDetails,
  saveLinkedInDM,
  saveEmailData,
  saveResumeForContact,
} from "../services/outreach/contact-logger.js";
import { logKeywordGaps, logResumeHistory } from "../services/logging.js";
import { displayScore } from "../services/display.js";

// ── Main ──

async function main() {
  const inputPath = process.argv[2];

  let input;
  if (inputPath) {
    if (!fs.existsSync(inputPath)) {
      console.error(`Input file not found: ${inputPath}`);
      process.exit(1);
    }
    input = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  } else {
    // Read JSON from stdin
    const raw = fs.readFileSync("/dev/stdin", "utf-8");
    input = JSON.parse(raw);
  }
  const { analysis, rewrite: rewritten } = input;

  if (!analysis || !rewritten) {
    console.error("Input JSON must have 'analysis' and 'rewrite' keys");
    process.exit(1);
  }

  // Load resume data
  const resumeData = JSON.parse(fs.readFileSync(config.paths.resumeData, "utf-8"));

  // Flatten projects object into lowercased keys on rewritten
  // document.js expects aiResponse[key] where key = projectName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (rewritten.projects && typeof rewritten.projects === "object") {
    for (const [projectName, description] of Object.entries(rewritten.projects)) {
      const key = projectName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      rewritten[key] = description;
    }
  }
  console.log(`📂 Loaded resume: ${resumeData.personalInfo?.name}`);

  // ── Step 3: Deterministic ATS Scoring ──
  console.log("\n📊 Running ATS scoring...");
  const score = scoreResume(analysis, rewritten, resumeData);

  if (!rewritten.summary || !Array.isArray(rewritten.bullets) || rewritten.bullets.length < 4) {
    console.error("Invalid rewrite output: missing summary or < 4 bullets");
    process.exit(1);
  }

  // ── Logging ──
  logKeywordGaps(analysis.jdTitle || "", analysis);
  logResumeHistory(analysis, rewritten, score, "claude-code");

  logContactDetails(analysis.contact, {
    title: analysis.jdTitle,
    company: analysis.jdCompany,
  });

  // ── Display Score ──
  displayScore(score);

  // ── Email & LinkedIn DM ──
  const aiResponse = {
    ...rewritten,
    jdTitle: analysis.jdTitle || null,
    jdCompany: analysis.jdCompany || null,
    jobType: analysis.jobType || "Full-time",
    salary: analysis.salary || null,
    contact: analysis.contact,
    atsScore: score,
  };

  const emailData = generateEmail(aiResponse, resumeData);
  if (emailData) {
    console.log("\n📧 EMAIL:");
    console.log(`   To: ${emailData.to}`);
    console.log(`   Subject: ${emailData.subject}`);
    saveEmailData(emailData.to, emailData.subject, emailData.body);
  }

  const linkedInDM = generateLinkedInDM(aiResponse, resumeData);
  console.log("\n💼 LINKEDIN DM:");
  if (linkedInDM.linkedInUrl) {
    console.log(`   LinkedIn: ${linkedInDM.linkedInUrl}`);
  }
  console.log(`   Message: ${linkedInDM.message}`);
  console.log(`   Length: ${linkedInDM.message.length} chars`);
  saveLinkedInDM(linkedInDM.linkedInUrl, linkedInDM.message, linkedInDM.contactName);

  // ── Document Generation ──
  const userName = resumeData.personalInfo?.name || "Resume";
  const jobRole = "MERN-Developer";
  const outputPaths = config.paths.getOutputPaths(userName, jobRole);

  console.log(`\n📁 Output: ${outputPaths.pdf}`);
  const docxPath = await generateDocx(aiResponse, outputPaths, resumeData);

  const hasLibreOffice = checkLibreOffice();
  let outputPath = docxPath;
  if (hasLibreOffice) {
    outputPath = await convertToPdf(docxPath, outputPaths.pdf);
    cleanupDocx(docxPath);
  } else {
    console.log("📄 LibreOffice not found - keeping DOCX output");
  }

  // ── Save per-job resume copy ──
  saveResumeForContact(outputPath, analysis.jdTitle, analysis.jdCompany);

  // ── Summary output as JSON for Claude Code to read ──
  const result = {
    outputPath,
    atsScore: score.overallScore,
    hardReject: score.hardReject,
    keywordsMatched: (score.found || []).length,
    keywordsMissing: (score.missing || []).length,
    email: emailData ? { to: emailData.to, subject: emailData.subject } : null,
    linkedInDM: { message: linkedInDM.message, url: linkedInDM.linkedInUrl },
  };

  console.log("\n" + "═".repeat(60));
  console.log("✅ PIPELINE COMPLETE");
  console.log("═".repeat(60));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Pipeline error:", err.message);
  process.exit(1);
});
