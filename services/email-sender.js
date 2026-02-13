/**
 * Email Sender Service
 * Handles sending emails via SMTP using nodemailer
 */

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { markEmailAsSent, getUnsentEmails } from "./contact-logger.js";

dotenv.config();

// ============================================================
// CONFIGURATION
// ============================================================

function getEnv(name, required = true) {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const SMTP_HOST = getEnv("SMTP_HOST");
const SMTP_PORT = Number(getEnv("SMTP_PORT"));
const SMTP_SECURE = String(getEnv("SMTP_SECURE", false)).toLowerCase() === "true";
const SMTP_USER = getEnv("SMTP_USER");
const SMTP_PASS = getEnv("SMTP_PASS");
const FROM_NAME = process.env.FROM_NAME || "Job Applicant";

// Master resume path - must be set in .env for portability
const RESUME_PATH = process.env.RESUME_PATH;

// ============================================================
// TRANSPORTER
// ============================================================

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Verify SMTP connection
 * @returns {Promise<boolean>} True if connection is successful
 */
export async function verifyConnection() {
  try {
    await getTransporter().verify();
    console.log("✅ SMTP connection verified");
    return true;
  } catch (error) {
    console.error("❌ SMTP connection failed:", error.message);
    return false;
  }
}

// ============================================================
// EMAIL SENDING
// ============================================================

/**
 * Send a single email
 * @param {Object} emailData - Email object {to, subject, body}
 * @param {boolean} markSent - Whether to mark as sent in contacts.json
 * @returns {Promise<Object>} Send result with success status
 */
export async function sendEmail(emailData, markSent = true) {
  const { to, subject, body } = emailData;

  if (!to || !subject || !body) {
    throw new Error("Email must have to, subject, and body");
  }

  // TODO : Remove this after testing
  // const actualRecipient = "ajaytest07@yopmail.com";
  const actualRecipient = to;

  // Prepare attachments (master resume)
  const attachments = [];
  if (RESUME_PATH && fs.existsSync(RESUME_PATH)) {
    attachments.push({
      filename: path.basename(RESUME_PATH),
      path: RESUME_PATH,
    });
  } else if (RESUME_PATH) {
    console.warn(`⚠️  Resume not found at: ${RESUME_PATH}`);
    console.warn(`   Email will be sent without attachment`);
  }

  try {
    const info = await getTransporter().sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to: actualRecipient,
      subject,
      text: body,
      attachments,
    });

    console.log(`✅ Email sent to ${actualRecipient} | messageId=${info.messageId}`);

    if (markSent) {
      markEmailAsSent(to);
    }

    return {
      success: true,
      messageId: info.messageId,
      to: actualRecipient,
    };
  } catch (error) {
    console.error(`❌ Failed to send email to ${actualRecipient}:`, error.message);
    return {
      success: false,
      error: error.message,
      to: actualRecipient,
    };
  }
}

/**
 * Send emails from a JSON file
 * @param {string} filePath - Path to emails.json file
 * @param {number} delayMs - Delay between emails in milliseconds (default 1200ms)
 * @returns {Promise<Object>} Results with sent/failed counts
 */
export async function sendEmailsFromFile(filePath, delayMs = 1200) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const emails = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error("emails.json must contain an array of email objects");
  }

  console.log(`📧 Loaded ${emails.length} emails from ${filePath}`);

  // Verify connection first
  const connected = await verifyConnection();
  if (!connected) {
    throw new Error("SMTP connection failed - check your .env settings");
  }

  const results = {
    sent: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];

    if (!email?.to || !email?.subject || !email?.body) {
      console.warn(`⚠️  Skipping index ${i}: missing to/subject/body`);
      results.failed++;
      continue;
    }

    const result = await sendEmail(email, false); // Don't mark as sent for batch sends

    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push({ to: email.to, error: result.error });
    }

    // Delay between emails to avoid spam detection
    if (i < emails.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log("\n📊 SEND SUMMARY:");
  console.log(`   ✅ Sent: ${results.sent}`);
  console.log(`   ❌ Failed: ${results.failed}`);

  return results;
}

/**
 * Send all unsent emails from contacts.json
 * @param {Function} emailGenerator - Function to generate email content for each contact
 * @param {number} delayMs - Delay between emails in milliseconds
 * @returns {Promise<Object>} Results with sent/failed counts
 */
export async function sendUnsentEmails(emailGenerator, delayMs = 1200) {
  const unsentEmails = getUnsentEmails();

  if (unsentEmails.length === 0) {
    console.log("✅ No unsent emails found in contacts.json");
    return { sent: 0, failed: 0, errors: [] };
  }

  console.log(`📧 Found ${unsentEmails.length} unsent emails`);

  // Verify connection first
  const connected = await verifyConnection();
  if (!connected) {
    throw new Error("SMTP connection failed - check your .env settings");
  }

  const results = {
    sent: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < unsentEmails.length; i++) {
    const contact = unsentEmails[i];

    // Generate email content using provided generator function
    const emailData = await emailGenerator(contact);

    if (!emailData) {
      console.warn(`⚠️  Skipping ${contact.to}: email generator returned null`);
      results.failed++;
      continue;
    }

    const result = await sendEmail(emailData, true); // Mark as sent

    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push({ to: contact.to, error: result.error });
    }

    // Delay between emails
    if (i < unsentEmails.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log("\n📊 SEND SUMMARY:");
  console.log(`   ✅ Sent: ${results.sent}`);
  console.log(`   ❌ Failed: ${results.failed}`);

  return results;
}

// ============================================================
// UTILITIES
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default {
  sendEmail,
  sendEmailsFromFile,
  sendUnsentEmails,
  verifyConnection,
};
