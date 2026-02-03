/**
 * AI Service - Gemini API for resume tailoring
 * Optimized for maximum ATS score
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
 * Build optimized prompt for maximum ATS match
 */
function buildPrompt(jobDescription, resumeData) {
  const allSkills = [
    ...resumeData.skills.frontend,
    ...resumeData.skills.backend,
    ...resumeData.skills.toolsDevOps,
    ...resumeData.skills.other,
  ];

  return `You are an ATS (Applicant Tracking System) optimization expert. Your goal is to maximize keyword match score.

## RULES:

### ALLOWED:
- Rewrite and enhance achievements based on existing experience
- Combine experiences into stronger bullet points
- Match JD keywords exactly as written
- ADD SIMILAR/ADJACENT SKILLS for ATS even if basic exposure:
  - If knows MySQL → can add PostgreSQL, SQL databases
  - If knows MongoDB → can add NoSQL databases
  - If knows Express → can add Fastify (similar Node frameworks)
  - If knows REST APIs → can add API rate limiting, request validation, throttling
  - If knows Node.js backend → can add event-driven architecture, background jobs
  - If knows JWT → can add OAuth, authentication flows
  - If built microservices or modular code → can add microservices architecture
- Include infrastructure keywords naturally in bullets

### NOT ALLOWED:
- Add completely unrelated technologies (no ML/AI, no Kubernetes if never used)
- Claim senior-level expertise in tools only used at basic level
- Invent achievements with no basis in experience

## JOB DESCRIPTION:
${jobDescription}

## CANDIDATE DATA:

Name: ${resumeData.personalInfo.name}
Role: ${resumeData.experience[0].title}
Company: ${resumeData.experience[0].company}
Duration: ${resumeData.experience[0].duration}

CORE SKILLS (definitely has):
${allSkills.join(', ')}

EXPERIENCE (enhance these, add ATS keywords):
${resumeData.experience[0].bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}

PROJECTS:
${resumeData.projects.map(p => `- ${p.name}: ${p.technologies.join(', ')}`).join('\n')}

## OUTPUT REQUIREMENTS:

### SUMMARY (250-350 chars)
- Include years of experience + role
- Pack in 4-5 key technologies from JD
- One achievement with metric
- Make it keyword-dense for ATS

### BULLETS (exactly 5, each 120-180 chars)
- Longer, more detailed bullets
- MUST include ATS keywords from JD naturally
- Include infrastructure terms: rate limiting, caching, queues, validation
- Mention specific technologies by name
- Include metrics where possible
- Format: "[Verb] [detailed task with tech keywords] [result/metric]"

### SKILLS (10-12, comma-separated)
- First: Exact matches from JD that candidate has
- Then: Adjacent/similar skills for ATS boost
- Include both: "PostgreSQL" AND "MySQL" if candidate knows SQL
- Include: Redis, OAuth, JWT if any auth/caching experience
- Use exact JD terminology

## IMPORTANT FOR ATS:
- Mirror EXACT keywords from job description
- If JD says "Node.js" use "Node.js" not "NodeJS"
- If JD mentions "API rate limiting" include that exact phrase
- If JD mentions "background jobs" or "queues" include those terms
- Add security terms if JD mentions them: request validation, authentication

## JSON OUTPUT (no markdown):
{
  "summary": "250-350 chars, keyword-dense",
  "bullets": [
    "120-180 chars with ATS keywords",
    "120-180 chars with ATS keywords",
    "120-180 chars with ATS keywords",
    "120-180 chars with ATS keywords",
    "120-180 chars with ATS keywords"
  ],
  "skills": "Skill1, Skill2, Skill3, Skill4, Skill5, Skill6, Skill7, Skill8, Skill9, Skill10"
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
    console.log(`   Skills: ${parsed.skills.split(',').length} items`);

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
