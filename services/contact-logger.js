/**
 * Contact Details Logger
 * Saves contact information from job descriptions
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = path.join(__dirname, "..", "logs");
const CONTACT_LOG = path.join(LOG_DIR, "contacts.json");

/**
 * Save contact details from a job description
 * @param {Object} contact - Contact information
 * @param {Object} jobInfo - Job details (title, company)
 */
export function logContactDetails(contact, jobInfo) {
  // Skip if no contact info
  if (!contact || (!contact.email && !contact.phone && !contact.link && !contact.name)) {
    return;
  }

  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  let contacts = [];
  if (fs.existsSync(CONTACT_LOG)) {
    try {
      contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));
    } catch (e) {
      contacts = [];
    }
  }

  const entry = {
    date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
    job: {
      title: jobInfo.title || null,
      company: jobInfo.company || null,
    },
    contacts: [],
    // Additional context (subject line, instructions, etc.)
    description: contact.instructions || null,
    // Email tracking
    emailSent: false,
    emailSentDate: null,
    // LinkedIn DM message (for manual sending - not tracked)
    linkedInDM: null,
  };

  // Add email
  if (contact.email) {
    entry.contacts.push({
      type: "email",
      value: contact.email,
      name: contact.name || null
    });
  }

  // Add phone
  if (contact.phone) {
    entry.contacts.push({
      type: "phone",
      value: contact.phone,
      name: contact.name || null
    });
  }

  // Add link (LinkedIn, Twitter, portfolio, website, etc.)
  if (contact.link) {
    entry.contacts.push({
      type: "link",
      value: contact.link,
      name: contact.name || null
    });
  }

  // Only save if we have actual contact methods
  if (entry.contacts.length > 0) {
    contacts.push(entry);
    fs.writeFileSync(CONTACT_LOG, JSON.stringify(contacts, null, 2));

    console.log(`\n💾 Contact details saved to logs/contacts.json`);
  }
}

/**
 * Mark an email as sent in the contacts log
 * @param {string} email - Email address that was sent to
 * @returns {boolean} True if marked successfully, false otherwise
 */
export function markEmailAsSent(email) {
  if (!fs.existsSync(CONTACT_LOG)) {
    return false;
  }

  try {
    const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));

    // Find the entry with this email and mark it as sent
    let found = false;
    for (const entry of contacts) {
      const emailContact = entry.contacts.find(
        c => c.type === 'email' && c.value === email
      );
      if (emailContact && !entry.emailSent) {
        entry.emailSent = true;
        entry.emailSentDate = new Date().toISOString().split('T')[0];
        found = true;
        break; // Only mark the first unsent occurrence
      }
    }

    if (found) {
      fs.writeFileSync(CONTACT_LOG, JSON.stringify(contacts, null, 2));
      return true;
    }

    return false;
  } catch (e) {
    console.error('Error marking email as sent:', e.message);
    return false;
  }
}

/**
 * Check if an email address has been sent to before
 * @param {string} email - Email address to check
 * @returns {Object|null} Previous sent entry info or null
 */
export function checkPreviouslySent(email) {
  if (!fs.existsSync(CONTACT_LOG)) {
    return null;
  }

  try {
    const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));

    const previousEntry = contacts.find(entry => {
      const emailContact = entry.contacts.find(c => c.type === 'email' && c.value === email);
      return emailContact && entry.emailSent;
    });

    if (previousEntry) {
      return {
        email,
        jobTitle: previousEntry.job.title,
        company: previousEntry.job.company,
        sentDate: previousEntry.emailSentDate,
        emailData: previousEntry.emailData || null,
      };
    }

    return null;
  } catch (e) {
    console.error('Error checking previously sent emails:', e.message);
    return null;
  }
}

/**
 * Get all unsent email contacts from the log
 * Includes saved email data (subject/body) if available
 * @returns {Array} Array of email objects with job info and email template
 */
export function getUnsentEmails() {
  if (!fs.existsSync(CONTACT_LOG)) {
    return [];
  }

  try {
    const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));

    return contacts
      .filter(entry => !entry.emailSent)
      .map(entry => {
        const emailContact = entry.contacts.find(c => c.type === 'email');
        if (!emailContact) return null;

        return {
          to: emailContact.value,
          contactName: emailContact.name,
          jobTitle: entry.job.title,
          jobCompany: entry.job.company,
          description: entry.description,
          date: entry.date,
          // Include saved email template if available
          emailData: entry.emailData || null,
        };
      })
      .filter(Boolean); // Remove null entries
  } catch (e) {
    console.error('Error reading unsent emails:', e.message);
    return [];
  }
}

/**
 * Save LinkedIn DM message to contact entry
 * ALWAYS saves message - matches by LinkedIn URL if available, otherwise uses most recent entry
 * @param {string|null} linkedInUrl - LinkedIn URL (can be null)
 * @param {string} message - Generated LinkedIn DM message
 * @param {string|null} contactName - Contact name (can be null)
 * @returns {boolean} True if saved successfully
 */
export function saveLinkedInDM(linkedInUrl, message, contactName = null) {
  if (!fs.existsSync(CONTACT_LOG)) {
    return false;
  }

  try {
    const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));

    if (contacts.length === 0) {
      return false;
    }

    let targetEntry = null;

    // If LinkedIn URL provided, try to find entry with matching URL
    if (linkedInUrl) {
      for (let i = contacts.length - 1; i >= 0; i--) {
        const entry = contacts[i];
        const linkContact = entry.contacts.find(
          c => c.type === 'link' && c.value === linkedInUrl
        );
        if (linkContact) {
          targetEntry = entry;
          break;
        }
      }
    }

    // If no URL provided or URL not found, use most recent entry
    if (!targetEntry) {
      targetEntry = contacts[contacts.length - 1];
    }

    // Save LinkedIn DM message
    targetEntry.linkedInDM = {
      message,
      contactName,
      linkedInUrl,
      generatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(CONTACT_LOG, JSON.stringify(contacts, null, 2));
    console.log(`💾 LinkedIn DM saved to logs/contacts.json`);
    return true;
  } catch (e) {
    console.error('Error saving LinkedIn DM:', e.message);
    return false;
  }
}

/**
 * Save email data (subject and body) to the most recent contact entry
 * @param {string} email - Email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body
 * @returns {boolean} True if saved successfully
 */
export function saveEmailData(email, subject, body) {
  if (!fs.existsSync(CONTACT_LOG)) {
    return false;
  }

  try {
    const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));

    // Find the most recent entry with this email
    for (let i = contacts.length - 1; i >= 0; i--) {
      const entry = contacts[i];
      const emailContact = entry.contacts.find(
        c => c.type === 'email' && c.value === email
      );
      if (emailContact) {
        entry.emailData = {
          subject,
          body,
          generatedAt: new Date().toISOString()
        };
        fs.writeFileSync(CONTACT_LOG, JSON.stringify(contacts, null, 2));
        console.log(`💾 Email template saved to logs/contacts.json`);
        return true;
      }
    }

    return false;
  } catch (e) {
    console.error('Error saving email data:', e.message);
    return false;
  }
}

export default {
  logContactDetails,
  markEmailAsSent,
  getUnsentEmails,
  checkPreviouslySent,
  saveLinkedInDM,
  saveEmailData,
};
