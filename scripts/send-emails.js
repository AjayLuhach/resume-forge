#!/usr/bin/env node

/**
 * Email Sender CLI
 * Sends emails to contacts logged in logs/contacts.json
 *
 * Usage:
 *   node scripts/send-emails.js                    # Send all unsent emails
 *   node scripts/send-emails.js --file emails.json # Send from custom file
 *   node scripts/send-emails.js --verify           # Test SMTP connection
 */

import readline from "readline";
import {
  sendEmail,
  sendEmailsFromFile,
  verifyConnection,
} from "../services/email-sender.js";
import { getUnsentEmails, checkPreviouslySent, markEmailAsSent } from "../services/contact-logger.js";

// ============================================================
// CONFIRMATION PROMPT
// ============================================================

function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// ============================================================
// CLI ARGUMENT PARSING
// ============================================================

const args = process.argv.slice(2);
const mode = args[0];

async function main() {
  console.log("\n📧 EMAIL SENDER CLI\n");

  // Verify connection mode
  if (mode === "--verify") {
    console.log("Testing SMTP connection...");
    const success = await verifyConnection();
    process.exit(success ? 0 : 1);
  }

  // Send from custom file
  if (mode === "--file") {
    const filePath = args[1];
    if (!filePath) {
      console.error("❌ Error: Please specify a file path");
      console.log("\nUsage: node scripts/send-emails.js --file emails.json");
      process.exit(1);
    }

    console.log(`📂 Sending emails from: ${filePath}\n`);
    const results = await sendEmailsFromFile(filePath);

    if (results.failed > 0) {
      console.log("\n❌ ERRORS:");
      results.errors.forEach((err) => {
        console.log(`   ${err.to}: ${err.error}`);
      });
    }

    process.exit(results.failed > 0 ? 1 : 0);
  }

  // Default: Send only approved emails from contacts.json
  console.log("📋 Sending approved emails from logs/contacts.json\n");
  console.log("💡 TIP: Use the dashboard (npm run web → /emails.html) to approve emails first\n");

  const unsentEmails = getUnsentEmails();

  if (unsentEmails.length === 0) {
    console.log("✅ No approved unsent emails found in contacts.json");
    console.log("   Approve emails via the dashboard before sending");
    process.exit(0);
  }

  console.log(`📧 Found ${unsentEmails.length} approved email(s) to send\n`);

  // Verify connection first
  const connected = await verifyConnection();
  if (!connected) {
    throw new Error("SMTP connection failed - check your .env settings");
  }

  const results = {
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (let i = 0; i < unsentEmails.length; i++) {
    const contact = unsentEmails[i];

    // Check if this email was sent before
    const previouslySent = checkPreviouslySent(contact.to);

    if (previouslySent) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`⚠️  DUPLICATE EMAIL WARNING`);
      console.log(`${'='.repeat(70)}`);
      console.log(`\n📧 Email Address: ${contact.to}`);
      console.log(`\n📅 PREVIOUS EMAIL (sent ${previouslySent.sentDate}):`);
      console.log(`   Job: ${previouslySent.jobTitle || 'Unknown'} at ${previouslySent.company || 'Unknown'}`);

      if (previouslySent.emailData) {
        console.log(`   Subject: ${previouslySent.emailData.subject || 'N/A'}`);
        if (previouslySent.emailData.body) {
          const preview = previouslySent.emailData.body.substring(0, 150).replace(/\n/g, ' ');
          console.log(`   Body: ${preview}...`);
        }
      }

      console.log(`\n📧 CURRENT EMAIL (attempting to send):`);
      console.log(`   Job: ${contact.jobTitle || 'Unknown'} at ${contact.jobCompany || 'Unknown'}`);

      if (contact.emailData) {
        console.log(`   Subject: ${contact.emailData.subject || 'N/A'}`);
        if (contact.emailData.body) {
          const preview = contact.emailData.body.substring(0, 150).replace(/\n/g, ' ');
          console.log(`   Body: ${preview}...`);
        }
      }

      console.log(`\n${'='.repeat(70)}`);
      const shouldSend = await askConfirmation("Send anyway? (y/n): ");

      if (!shouldSend) {
        console.log(`⏭️  Skipped - marking as sent without sending\n`);
        markEmailAsSent(contact.to);
        results.skipped++;
        continue;
      }
      console.log(`✅ Confirmed - proceeding to send\n`);
    }

    // Generate email content
    let emailData;
    if (contact.emailData && contact.emailData.subject && contact.emailData.body) {
      console.log(`   Using saved email template for ${contact.to}`);
      emailData = {
        to: contact.to,
        subject: contact.emailData.subject,
        body: contact.emailData.body,
      };
    } else {
      console.log(`   Generating generic template for ${contact.to}`);
      const subject = `Application for ${contact.jobTitle || "the open position"}${contact.jobCompany ? ` at ${contact.jobCompany}` : ""}`;
      const body = `Dear ${contact.contactName || "Hiring Manager"},

I hope this message finds you well. I am writing to express my interest in the ${contact.jobTitle || "open position"}${contact.jobCompany ? ` at ${contact.jobCompany}` : ""}. Please find my resume attached for your consideration.

${contact.description || "I would welcome the opportunity to discuss how my skills and experience align with your requirements."}

Looking forward to hearing from you.

Best regards,
${process.env.FROM_NAME || "Job Applicant"}`;

      emailData = { to: contact.to, subject, body };
    }

    // Attach per-job tailored resume if available
    if (contact.resumePath) {
      emailData.resumePath = contact.resumePath;
    }

    // Send email
    const result = await sendEmail(emailData, true);

    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push({ to: contact.to, error: result.error });
    }

    // Delay between emails
    if (i < unsentEmails.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  console.log("\n📊 SEND SUMMARY:");
  console.log(`   ✅ Sent: ${results.sent}`);
  console.log(`   ⏭️  Skipped: ${results.skipped}`);
  console.log(`   ❌ Failed: ${results.failed}`);

  if (results.failed > 0) {
    console.log("\n❌ ERRORS:");
    results.errors.forEach((err) => {
      console.log(`   ${err.to}: ${err.error}`);
    });
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

// ============================================================
// ERROR HANDLING
// ============================================================

main().catch((error) => {
  console.error("\n❌ FATAL ERROR:", error.message);

  if (error.message.includes("Missing required environment variable")) {
    console.log("\n💡 TIP: Make sure you have configured SMTP settings in your .env file");
    console.log("   See .env.example for reference");
  }

  process.exit(1);
});
