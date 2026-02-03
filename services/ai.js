/**
 * AI Service - Gemini API for resume tailoring
 * Optimized prompt to prevent hallucination and ensure ATS compliance
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config.js';

/**
 * Initialize Gemini AI client
 */
function initializeClient() {
  if (!config.ai.geminiApiKey) {
    throw new Error(
      'GEMINI_API_KEY environment variable is not set.\n' +
      'Get your API key from: https://makersuite.google.com/app/apikey\n' +
      'Then run: export GEMINI_API_KEY=your_api_key_here'
    );
  }
  return new GoogleGenerativeAI(config.ai.geminiApiKey);
}

/**
 * Build optimized prompt - prevents hallucination, enforces constraints
 */
function buildPrompt(jobDescription, resumeData) {
  // Flatten skills for easy reference
  const allSkills = [
    ...resumeData.skills.frontend,
    ...resumeData.skills.backend,
    ...resumeData.skills.toolsDevOps,
    ...resumeData.skills.other,
  ];

  return `You are an ATS resume optimizer. Tailor resume content for maximum job match.

## RULES:

### ALLOWED (DO THIS):
- Rewrite and enhance achievements creatively based on existing experience
- Combine multiple experiences into stronger bullet points
- Rephrase to match job description keywords
- Reasonably extrapolate from existing work (e.g., "built APIs" can become "designed RESTful APIs")
- Adjust metrics within reasonable range based on context

### NOT ALLOWED (NEVER DO THIS):
- Add technologies candidate doesn't have (no Kubernetes if not in skills)
- Claim experience with tools not listed (no CUDA, no ML if not mentioned)
- Invent completely new achievements unrelated to their work
- Add skills outside their tech stack

## JOB DESCRIPTION:
${jobDescription}

## CANDIDATE DATA:

Name: ${resumeData.personalInfo.name}
Role: ${resumeData.experience[0].title}
Company: ${resumeData.experience[0].company}
Duration: ${resumeData.experience[0].duration}

SKILLS (only use these technologies):
${allSkills.join(', ')}

EXPERIENCE (enhance and rewrite these):
${resumeData.experience[0].bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}

PROJECTS (reference these):
${resumeData.projects.map(p => `- ${p.name}: ${p.technologies.join(', ')}`).join('\n')}

## OUTPUT FORMAT:

### SUMMARY (200-280 chars)
Format: "[Years] experience as [Role] specializing in [2-3 techs from JD]. [Achievement]. [Value]."

### BULLETS (exactly 6, each 80-150 chars)
Format: "[Action verb] [task] using [tech from JD] [result with metric]"
Good verbs: Built, Developed, Optimized, Implemented, Integrated, Designed, Architected, Scaled

### SKILLS (8-10, comma-separated)
Prioritize: Skills that appear in BOTH job description AND candidate skills
Use exact JD terminology (e.g., if JD says "Node.js", use "Node.js" not "NodeJS")

## JSON OUTPUT (no markdown, no explanation):
{
  "summary": "200-280 chars",
  "bullets": ["80-150 chars each", "...", "...", "...", "...", "..."],
  "skills": "Skill1, Skill2, Skill3, Skill4, Skill5, Skill6, Skill7, Skill8"
}`;
}

/**
 * Parse and validate AI response
 */
function parseResponse(response) {
  let text = response.trim();

  // Remove markdown code blocks
  if (text.startsWith('```json')) text = text.slice(7);
  else if (text.startsWith('```')) text = text.slice(3);
  if (text.endsWith('```')) text = text.slice(0, -3);
  text = text.trim();

  try {
    const parsed = JSON.parse(text);

    // Validate structure
    if (!parsed.summary || typeof parsed.summary !== 'string') {
      throw new Error('Missing "summary"');
    }
    if (!Array.isArray(parsed.bullets) || parsed.bullets.length < 4) {
      throw new Error('Need at least 4 bullets');
    }
    if (!parsed.skills || typeof parsed.skills !== 'string') {
      throw new Error('Missing "skills"');
    }

    // Log lengths for debugging
    console.log(`   Summary: ${parsed.summary.length} chars`);
    parsed.bullets.forEach((b, i) => {
      console.log(`   Bullet ${i + 1}: ${b.length} chars`);
    });

    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }
}

/**
 * Tailor resume using Gemini AI
 */
export async function tailorResume(jobDescription, resumeData) {
  console.log('🤖 Sending to Gemini AI...');

  const genAI = initializeClient();
  const model = genAI.getGenerativeModel({ model: config.ai.model });
  const prompt = buildPrompt(jobDescription, resumeData);

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    console.log('✅ Received response, validating...');
    const parsed = parseResponse(text);
    console.log('✅ Validation passed');

    return parsed;
  } catch (error) {
    throw new Error(`AI tailoring failed: ${error.message}`);
  }
}

export default { tailorResume };
