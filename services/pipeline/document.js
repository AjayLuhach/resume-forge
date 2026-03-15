/**
 * Document Service - Handles DOCX template manipulation
 */

import fs from 'fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import config from '../../config.js';

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
      '{{NAME}}, {{SUMMARY}}, {{SKILLS}}, {{#experiences}}, {{#projects}}, {{#education}}'
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
 * @param {object} resumeData - Resume data from JSON
 * @returns {object} Template data object
 */
function prepareTemplateData(aiResponse, resumeData) {
  const { title, summary, bullets, skills } = aiResponse;
  const personalInfo = resumeData.personalInfo || {};

  // Personal info
  const templateData = {
    TITLE: title || 'Full Stack Developer',
    SUMMARY: summary,
    SKILLS: skills,
    NAME: personalInfo.name || '',
    LOCATION: personalInfo.location || '',
    EMAIL: personalInfo.email || '',
    PHONE: personalInfo.phone || '',
    LINKEDIN: personalInfo.linkedin || '',
    GITHUB: personalInfo.github || '',
    PORTFOLIO: personalInfo.portfolio || '',
  };

  // Experience entries (loop data)
  templateData.experiences = (resumeData.experience || []).map(exp => ({
    title: exp.title || '',
    company: exp.company || '',
    location: exp.location || '',
    duration: exp.duration || '',
    bullets: exp.isCurrent ? (bullets || []) : (exp.bullets || []),
  }));

  // Personal projects (loop data) with AI-generated descriptions
  templateData.projects = (resumeData.projects || []).map(project => {
    const key = project.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return {
      name: project.name || '',
      description: aiResponse[key] || '',
    };
  });

  // Education entries (loop data)
  templateData.education = (resumeData.education || []).map(edu => ({
    degree: edu.degree || '',
    institution: edu.institution || '',
    duration: edu.duration || '',
    score: edu.score || '',
  }));

  return templateData;
}

/**
 * Generate tailored resume DOCX from template
 * @param {object} aiResponse - Response from AI service
 * @param {object} outputPaths - Output paths for DOCX/PDF
 * @param {object} resumeData - Resume data from JSON
 * @returns {Promise<string>} Path to generated DOCX file
 */
export async function generateDocx(aiResponse, outputPaths, resumeData) {
  console.log('📄 Generating tailored DOCX...');

  try {
    const doc = loadTemplate(config.paths.template);
    const templateData = prepareTemplateData(aiResponse, resumeData);

    console.log('📝 Replacing placeholders:');
    console.log(`   - Name: ${templateData.NAME}`);
    console.log(`   - Title: ${templateData.TITLE}`);
    console.log(`   - Summary: ${templateData.SUMMARY.substring(0, 50)}...`);
    console.log(`   - Skills: ${templateData.SKILLS.substring(0, 50)}...`);
    console.log(`   - Experiences: ${templateData.experiences.length} entries`);
    templateData.experiences.forEach(exp => {
      console.log(`     • ${exp.title} @ ${exp.company} (${exp.bullets.length} bullets)`);
    });
    console.log(`   - Projects: ${templateData.projects.length} entries`);
    templateData.projects.forEach(proj => {
      console.log(`     • ${proj.name}: ${(proj.description || '').substring(0, 50)}...`);
    });
    console.log(`   - Education: ${templateData.education.length} entries`);

    // Replace placeholders
    doc.render(templateData);

    // Generate output
    const buffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    // Write to file
    fs.writeFileSync(outputPaths.docx, buffer);

    console.log(`✅ DOCX saved: ${outputPaths.docx}`);

    return outputPaths.docx;
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
    const requiredPlaceholders = ['NAME', 'SUMMARY', 'SKILLS'];
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
