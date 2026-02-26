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
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import config from "../config.js";
import { scoreResume } from "../services/ats-scorer.js";
import { generateDocx } from "../services/document.js";
import { convertToPdf, cleanupDocx, checkLibreOffice } from "../services/converter.js";
import { generateEmail, generateLinkedInDM } from "../services/email-generator.js";
import {
  logContactDetails,
  saveLinkedInDM,
  saveEmailData,
} from "../services/contact-logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = path.join(__dirname, "..", "logs");
const KEYWORD_LOG = path.join(LOG_DIR, "keyword_gaps.json");
const RESUME_LOG = path.join(LOG_DIR, "resume_history.json");

// ── Logging helpers (same as ai-bedrock.js) ──

function logKeywordGaps(jobTitle, analysis) {
  const cannotClaim = analysis.cannotClaim || [];
  const missing = analysis.missing || [];
  if (cannotClaim.length === 0 && missing.length === 0) return;

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  let log = { entries: [], summary: {} };
  if (fs.existsSync(KEYWORD_LOG)) {
    try { log = JSON.parse(fs.readFileSync(KEYWORD_LOG, "utf-8")); } catch { log = { entries: [], summary: {} }; }
  }

  log.entries.push({
    date: new Date().toISOString(),
    jobTitle: (jobTitle || "").substring(0, 100),
    cannotClaim,
    missing,
  });

  [...cannotClaim, ...missing].forEach((kw) => {
    const key = kw.toLowerCase().trim();
    log.summary[key] = (log.summary[key] || 0) + 1;
  });

  fs.writeFileSync(KEYWORD_LOG, JSON.stringify(log, null, 2));
}

function logResumeHistory(analysis, rewritten, score) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  let history = [];
  if (fs.existsSync(RESUME_LOG)) {
    try { history = JSON.parse(fs.readFileSync(RESUME_LOG, "utf-8")); } catch { history = []; }
  }

  history.push({
    date: new Date().toISOString(),
    job: {
      title: analysis.jdTitle || null,
      company: analysis.jdCompany || null,
      language: analysis.jdLang || null,
      yearsRequired: analysis.jdYears || null,
      contact: analysis.contact || null,
    },
    score: {
      final: score.overallScore,
      keywordExact: score.keywordExact,
      hardReject: score.hardReject,
      penalties: score.penalties,
    },
    resume: {
      summary: rewritten.summary,
      skills: rewritten.skills,
      bullets: rewritten.bullets,
      projects: rewritten.projects || {},
      projectsUsed: rewritten.projectsUsed || [],
    },
    keywords: {
      matched: score.found,
      missing: score.missing,
    },
  });

  fs.writeFileSync(RESUME_LOG, JSON.stringify(history, null, 2));
}

// ── Display helpers ──

function displayScore(score) {
  console.log("\n" + "─".repeat(60));
  console.log("STEP 3: ATS SCORE (Deterministic)");
  console.log("─".repeat(60));

  const emoji = score.overallScore >= 70 ? "🟢" : score.overallScore >= 50 ? "🟡" : "🔴";
  console.log(`\n${emoji} FINAL SCORE: ${score.overallScore}%`);
  console.log(`   Keyword Exact Match: ${score.keywordExact}%`);

  console.log("\n📊 HARD GATES:");
  console.log(`   Title Match:      ${score.titleMatch === true ? "✅ Yes" : score.titleMatch === false ? "❌ No" : "⚠️  Unknown"}`);
  console.log(`   Experience Match: ${score.expMatch === true ? "✅ Yes" : score.expMatch === false ? "❌ No" : "⚠️  Unknown"}`);
  console.log(`   Hard Reject:      ${score.hardReject === true ? "🚫 YES" : "✅ No"}`);

  if (score.hardReject && score.rejectReason) {
    console.log(`\n🚫 REJECT REASON: ${score.rejectReason}`);
  }

  if (score.penalties && score.penalties.length > 0) {
    console.log("\n⚠️  PENALTIES APPLIED:");
    score.penalties.forEach((p) => console.log(`   - ${p}`));
  }

  console.log("\n✅ JD KEYWORDS MATCHED:");
  console.log("   " + (score.found || []).join(", ") || "none");

  if ((score.canClaimMatched || []).length > 0) {
    console.log("\n🎁 BONUS KEYWORDS (related skills used):");
    console.log("   " + score.canClaimMatched.join(", "));
  }

  if ((score.missing || []).length > 0) {
    console.log("\n❌ JD KEYWORDS MISSING:");
    console.log("   " + score.missing.join(", "));
  }

  console.log("\n" + "─".repeat(60));
}

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
  logResumeHistory(analysis, rewritten, score);

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
