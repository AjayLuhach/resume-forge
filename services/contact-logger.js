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
    description: contact.instructions || null
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

export default { logContactDetails };
