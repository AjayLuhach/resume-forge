/**
 * Clipboard Service - Simple clipboard reading
 * Let the AI do the heavy lifting of understanding job descriptions
 */

import clipboardy from 'clipboardy';

/**
 * Read text content from system clipboard
 * @returns {Promise<string>} Clipboard text content
 */
export async function readClipboard() {
  console.log('📋 Reading job description from clipboard...');

  try {
    const text = await clipboardy.read();

    if (!text || text.trim().length === 0) {
      throw new Error('Clipboard is empty. Please copy a job description first.');
    }

    const trimmed = text.trim();
    console.log(`✅ Read ${trimmed.length} characters from clipboard`);

    return trimmed;
  } catch (error) {
    if (error.message.includes('Clipboard is empty')) {
      throw error;
    }
    throw new Error(`Failed to read clipboard: ${error.message}`);
  }
}

/**
 * Basic validation - just check it's not too short
 * AI will handle actual content understanding
 * @param {string} text - Clipboard content
 * @returns {boolean} Whether content meets minimum requirements
 */
export function validateJobDescription(text) {
  const minLength = 100;

  if (text.length < minLength) {
    console.warn(`⚠️  Warning: Content seems short (${text.length} chars). Is this a complete job description?`);
    return false;
  }

  console.log('✅ Content length OK - AI will analyze the job description');
  return true;
}

export default { readClipboard, validateJobDescription };
