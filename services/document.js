/**
 * Document Service - Handles DOCX template manipulation
 */

import fs from 'fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import config from '../config.js';

/**
 * Load and parse DOCX template
 * @param {string} templatePath - Path to template file
 * @returns {Docxtemplater} Docxtemplater instance
 */
function loadTemplate(templatePath) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Template file not found: ${templatePath}\n` +
      'Please create a template.docx file with placeholders:\n' +
      '{{SUMMARY}}, {{SKILLS}}, {{B1}}, {{B2}}, {{B3}}, {{B4}}, {{B5}}, {{B6}}'
    );
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
  });

  return doc;
}

/**
 * Prepare template data from AI response
 * @param {object} aiResponse - Response from AI service
 * @returns {object} Template data object
 */
function prepareTemplateData(aiResponse) {
  const { summary, bullets, skills } = aiResponse;

  // Support 5 or 6 bullets
  const paddedBullets = [...bullets];
  while (paddedBullets.length < 5) {
    paddedBullets.push('');
  }

  return {
    SUMMARY: summary,
    SKILLS: skills,
    B1: paddedBullets[0] || '',
    B2: paddedBullets[1] || '',
    B3: paddedBullets[2] || '',
    B4: paddedBullets[3] || '',
    B5: paddedBullets[4] || '',
  };
}

/**
 * Generate tailored resume DOCX from template
 * @param {object} aiResponse - Response from AI service
 * @returns {Promise<string>} Path to generated DOCX file
 */
export async function generateDocx(aiResponse) {
  console.log('📄 Generating tailored DOCX...');

  try {
    const doc = loadTemplate(config.paths.template);
    const templateData = prepareTemplateData(aiResponse);

    console.log('📝 Replacing placeholders:');
    console.log(`   - Summary: ${templateData.SUMMARY.substring(0, 50)}...`);
    console.log(`   - Skills: ${templateData.SKILLS.substring(0, 50)}...`);
    console.log(`   - Bullets: ${aiResponse.bullets.length} points`);

    // Replace placeholders
    doc.render(templateData);

    // Generate output
    const buffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    // Write to file
    fs.writeFileSync(config.paths.outputDocx, buffer);

    console.log(`✅ DOCX saved: ${config.paths.outputDocx}`);

    return config.paths.outputDocx;
  } catch (error) {
    if (error.properties && error.properties.errors) {
      const templateErrors = error.properties.errors
        .map(e => `  - ${e.message}`)
        .join('\n');
      throw new Error(`Template errors:\n${templateErrors}`);
    }
    throw new Error(`Failed to generate DOCX: ${error.message}`);
  }
}

/**
 * Check if template exists and has required placeholders
 * @returns {boolean} Whether template is valid
 */
export function validateTemplate() {
  const templatePath = config.paths.template;

  if (!fs.existsSync(templatePath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { delimiters: { start: '{{', end: '}}' } });

    // Get all placeholders in template
    const text = doc.getFullText();
    const requiredPlaceholders = ['SUMMARY', 'B1', 'B2', 'B3', 'B4'];
    const missingPlaceholders = requiredPlaceholders.filter(
      p => !text.includes(`{{${p}}}`)
    );

    if (missingPlaceholders.length > 0) {
      console.warn(`⚠️  Missing placeholders in template: ${missingPlaceholders.join(', ')}`);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export default { generateDocx, validateTemplate };
