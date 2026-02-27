#!/usr/bin/env node

/**
 * Backfill Resume Files
 *
 * Regenerates tailored resume PDFs for existing contacts that have email data
 * but no saved resume file. Matches contacts to resume_history.json by date + job title,
 * then generates DOCX → PDF using the saved resume content.
 *
 * Usage: node scripts/backfill-resumes.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import config from "../config.js";
import { generateDocx } from "../services/document.js";
import { convertToPdf, cleanupDocx, checkLibreOffice } from "../services/converter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = path.join(__dirname, "..", "logs");
const CONTACT_LOG = path.join(LOG_DIR, "contacts.json");
const RESUME_LOG = path.join(LOG_DIR, "resume_history.json");
const RESUME_DIR = path.join(LOG_DIR, "resumes");

function sanitize(s) {
  return (s || "Unknown").replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "-").substring(0, 40);
}

async function main() {
  console.log("\n📂 BACKFILL RESUMES\n");

  if (!fs.existsSync(CONTACT_LOG) || !fs.existsSync(RESUME_LOG)) {
    console.log("Missing contacts.json or resume_history.json");
    process.exit(1);
  }

  const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));
  const history = JSON.parse(fs.readFileSync(RESUME_LOG, "utf-8"));
  const resumeData = JSON.parse(fs.readFileSync(config.paths.resumeData, "utf-8"));
  const hasLibreOffice = checkLibreOffice();

  if (!fs.existsSync(RESUME_DIR)) {
    fs.mkdirSync(RESUME_DIR, { recursive: true });
  }

  let backfilled = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    // Skip if already has resume or no email data
    if (contact.resumePath && fs.existsSync(contact.resumePath)) {
      skipped++;
      continue;
    }

    const hasEmail = contact.contacts.some(c => c.type === "email");
    if (!hasEmail || !contact.emailData) {
      skipped++;
      continue;
    }

    // Find matching history entry
    const match = history.find(h => {
      const hDate = h.date.split("T")[0];
      return hDate === contact.date && h.job.title === contact.job.title;
    });

    if (!match) {
      console.log(`  ⚠️  No history match: ${contact.job.title} (${contact.date})`);
      failed++;
      continue;
    }

    // Build aiResponse from history data for document generation
    const aiResponse = {
      title: match.resume.summary ? resumeData.personalInfo?.name : "Resume",
      summary: match.resume.summary,
      skills: match.resume.skills,
      bullets: match.resume.bullets,
      projectsUsed: match.resume.projectsUsed || [],
      jdTitle: match.job.title,
      jdCompany: match.job.company,
    };

    // Flatten projects
    if (match.resume.projects && typeof match.resume.projects === "object") {
      for (const [projectName, description] of Object.entries(match.resume.projects)) {
        const key = projectName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        aiResponse[key] = description;
      }
    }

    // Generate filename
    const date = contact.date;
    const ext = ".pdf";
    const filename = `${date}_${sanitize(match.job.company)}_${sanitize(match.job.title)}${ext}`;
    const destPath = path.join(RESUME_DIR, filename);

    // Skip if file already exists
    if (fs.existsSync(destPath)) {
      contact.resumePath = destPath;
      backfilled++;
      console.log(`  ✅ Already exists: ${filename}`);
      continue;
    }

    try {
      // Generate DOCX
      const userName = resumeData.personalInfo?.name || "Resume";
      const tempBasename = `backfill_${Date.now()}`;
      const tempDocx = path.join(RESUME_DIR, `${tempBasename}.docx`);
      const tempPdf = path.join(RESUME_DIR, `${tempBasename}.pdf`);
      const outputPaths = { docx: tempDocx, pdf: tempPdf };

      await generateDocx(aiResponse, outputPaths, resumeData);

      if (hasLibreOffice) {
        await convertToPdf(tempDocx, destPath);
        cleanupDocx(tempDocx);
        // Clean temp pdf if libreoffice generated it elsewhere
        if (fs.existsSync(tempPdf) && tempPdf !== destPath) {
          fs.unlinkSync(tempPdf);
        }
      } else {
        // No LibreOffice — keep DOCX
        const docxDest = destPath.replace(".pdf", ".docx");
        fs.renameSync(tempDocx, docxDest);
        contact.resumePath = docxDest;
        backfilled++;
        console.log(`  ✅ Generated (DOCX): ${path.basename(docxDest)}`);
        continue;
      }

      contact.resumePath = destPath;
      backfilled++;
      console.log(`  ✅ Generated: ${filename}`);
    } catch (e) {
      console.log(`  ❌ Failed: ${match.job.title} — ${e.message}`);
      failed++;
    }
  }

  // Save updated contacts
  fs.writeFileSync(CONTACT_LOG, JSON.stringify(contacts, null, 2));

  console.log(`\n📊 BACKFILL SUMMARY:`);
  console.log(`   ✅ Backfilled: ${backfilled}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);
}

main().catch(err => {
  console.error("Backfill error:", err.message);
  process.exit(1);
});
