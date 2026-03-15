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
const LOG_DIR = path.join(__dirname, "..", "..", "logs");
const CONTACT_LOG = path.join(LOG_DIR, "contacts.json");

/**
 * Save contact details from a job description
 * @param {Object} contact - Contact information
 * @param {Object} jobInfo - Job details (title, company)
 */
export function logContactDetails(contact, jobInfo) {
  // Skip if no contact info
  if (!contact || (!contact.email && !contact.phone && !contact.link && !contact.applyUrl && !contact.name)) {
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

  const hasEmail = !!contact.email;

  const entry = {
    date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
    job: {
      title: jobInfo.title || null,
      company: jobInfo.company || null,
    },
    contacts: [],
    // Additional context (subject line, instructions, etc.)
    description: contact.instructions || null,
    // Email workflow status: drafted → approved → sent (or rejected)
    status: hasEmail ? "drafted" : "no_email",
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

  // Add link (LinkedIn, Twitter, social profile of recruiter/poster)
  if (contact.link) {
    entry.contacts.push({
      type: "link",
      value: contact.link,
      name: contact.name || null
    });
  }

  // Add application URL (form, careers page, Google Form, etc.)
  if (contact.applyUrl) {
    entry.contacts.push({
      type: "apply_link",
      value: contact.applyUrl,
      name: contact.instructions || null
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
        entry.status = "sent";
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
 * Get approved, unsent email contacts from the log
 * Only returns contacts with status === "approved"
 * @returns {Array} Array of email objects with job info and email template
 */
export function getUnsentEmails() {
  if (!fs.existsSync(CONTACT_LOG)) {
    return [];
  }

  try {
    const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));

    return contacts
      .filter(entry => !entry.emailSent && entry.status === "approved")
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
          emailData: entry.emailData || null,
          resumePath: entry.resumePath || null,
        };
      })
      .filter(Boolean);
  } catch (e) {
    console.error('Error reading unsent emails:', e.message);
    return [];
  }
}

/**
 * Get all contacts with email data for dashboard display
 * Migrates legacy entries (no status field) to "drafted"
 * @returns {Array} Array of contact entries with index
 */
export function getAllEmailContacts() {
  if (!fs.existsSync(CONTACT_LOG)) {
    return [];
  }

  try {
    const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));
    let migrated = false;

    const results = contacts
      .map((entry, index) => {
        const emailContact = entry.contacts.find(c => c.type === 'email');
        if (!emailContact && !entry.emailData) return null;

        // Migrate legacy entries without status
        if (!entry.status) {
          if (entry.emailSent) {
            entry.status = "sent";
          } else if (entry.emailData) {
            entry.status = "drafted";
          } else {
            entry.status = "no_email";
          }
          migrated = true;
        }

        return { ...entry, _index: index };
      })
      .filter(Boolean);

    if (migrated) {
      fs.writeFileSync(CONTACT_LOG, JSON.stringify(contacts, null, 2));
    }

    return results;
  } catch (e) {
    console.error('Error reading email contacts:', e.message);
    return [];
  }
}

/**
 * Update email status by index
 * @param {number} index - Contact index in the array
 * @param {string} status - New status (approved/rejected/drafted)
 * @returns {boolean} True if updated
 */
export function updateEmailStatus(index, status) {
  const validStatuses = ["drafted", "approved", "rejected"];
  if (!validStatuses.includes(status)) return false;

  if (!fs.existsSync(CONTACT_LOG)) return false;

  try {
    const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));
    if (index < 0 || index >= contacts.length) return false;

    const entry = contacts[index];
    if (entry.emailSent) return false; // Can't change status of sent emails

    entry.status = status;
    fs.writeFileSync(CONTACT_LOG, JSON.stringify(contacts, null, 2));
    return true;
  } catch (e) {
    console.error('Error updating email status:', e.message);
    return false;
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
        if (!entry.status || entry.status === "no_email") {
          entry.status = "drafted";
        }
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

/**
 * Copy tailored resume to logs/resumes/ and save path to the most recent contact entry
 * @param {string} sourcePath - Path to the generated resume PDF
 * @param {string} jobTitle - Job title for filename
 * @param {string} company - Company name for filename
 * @returns {string|null} Path to the copied resume, or null on failure
 */
export function saveResumeForContact(sourcePath, jobTitle, company) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    console.warn(`⚠️  Resume not found at: ${sourcePath}`);
    return null;
  }

  const resumeDir = path.join(LOG_DIR, "resumes");
  if (!fs.existsSync(resumeDir)) {
    fs.mkdirSync(resumeDir, { recursive: true });
  }

  // Build filename: YYYY-MM-DD_Company_JobTitle.pdf
  const date = new Date().toISOString().split("T")[0];
  const sanitize = (s) => (s || "Unknown").replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "-").substring(0, 40);
  const ext = path.extname(sourcePath) || ".pdf";
  const filename = `${date}_${sanitize(company)}_${sanitize(jobTitle)}${ext}`;
  const destPath = path.join(resumeDir, filename);

  try {
    fs.copyFileSync(sourcePath, destPath);
    console.log(`💾 Resume saved to logs/resumes/${filename}`);

    // Save path to the most recent contact entry
    if (fs.existsSync(CONTACT_LOG)) {
      const contacts = JSON.parse(fs.readFileSync(CONTACT_LOG, "utf-8"));
      if (contacts.length > 0) {
        contacts[contacts.length - 1].resumePath = destPath;
        fs.writeFileSync(CONTACT_LOG, JSON.stringify(contacts, null, 2));
      }
    }

    return destPath;
  } catch (e) {
    console.error("Error saving resume copy:", e.message);
    return null;
  }
}

export default {
  logContactDetails,
  markEmailAsSent,
  getUnsentEmails,
  checkPreviouslySent,
  saveLinkedInDM,
  saveEmailData,
  getAllEmailContacts,
  updateEmailStatus,
  saveResumeForContact,
};
