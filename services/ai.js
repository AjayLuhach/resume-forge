/**
 * AI Service - Gemini API for resume tailoring
 * 3-Step Pipeline: Analyze → Rewrite → Score
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config.js';
import fs from 'fs';
import path from 'path';

// Log directory and file for tracking missed keywords
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'keyword_gaps.json');

/**
 * Log missed keywords to JSON file for later review
 */
function logKeywordGaps(jobTitle, analysis) {
  const cannotClaim = analysis.cannotClaim || [];
  const missing = analysis.missing || [];

  // Skip if nothing to log
  if (cannotClaim.length === 0 && missing.length === 0) return;

  // Create logs directory if it doesn't exist
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  // Load existing log or create new
  let log = { entries: [], summary: {} };
  if (fs.existsSync(LOG_FILE)) {
    try {
      log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    } catch (e) {
      // If corrupted, start fresh
      log = { entries: [], summary: {} };
    }
  }

  // Add new entry
  const entry = {
    date: new Date().toISOString(),
    jobTitle: jobTitle.substring(0, 100),
    cannotClaim,
    missing,
  };
  log.entries.push(entry);

  // Update summary (count frequency of each keyword)
  [...cannotClaim, ...missing].forEach(keyword => {
    const key = keyword.toLowerCase().trim();
    log.summary[key] = (log.summary[key] || 0) + 1;
  });

  // Save
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
  console.log(`\n📝 Keyword gaps logged to: ${LOG_FILE}`);
}

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

// ============================================================
// MODEL DISCOVERY & ROTATION
// ============================================================

/**
 * Fetch available models from Gemini API
 * @returns {Promise<string[]>} list of available model names
 */
async function fetchAvailableModels() {
  const apiKey = config.ai.geminiApiKey;
  if (!apiKey) return [];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!response.ok) {
      console.warn('   ⚠️  Could not fetch model list, using defaults');
      return [];
    }

    const data = await response.json();
    const models = data.models || [];

    // Filter for text generation models (gemini-*) that support generateContent
    const textModels = models
      .filter(m =>
        m.name.includes('gemini') &&
        m.supportedGenerationMethods?.includes('generateContent')
      )
      .map(m => m.name.replace('models/', ''))
      .filter(name =>
        // Exclude experimental/vision-only variants
        !name.includes('vision') &&
        !name.includes('embedding') &&
        !name.includes('aqa')
      );

    console.log(`\n📋 Available Gemini models: ${textModels.join(', ')}`);
    return textModels;
  } catch (error) {
    console.warn('   ⚠️  Error fetching models:', error.message);
    return [];
  }
}

// Cache for available models (refreshed once per session)
let cachedModels = null;

/**
 * Get available models, with preference ordering for each task type
 * @param {string} taskType - 'analysis', 'rewrite', or 'scoring'
 * @returns {Promise<string[]>} ordered list of models for this task
 */
async function getModelsForTask(taskType) {
  // Fetch models once and cache
  if (cachedModels === null) {
    cachedModels = await fetchAvailableModels();
  }

  // If API fetch failed, fall back to config defaults
  if (cachedModels.length === 0) {
    return config.ai.models[taskType] || config.ai.models.analysis;
  }

  // Preference order by task type (best first)
  const preferences = {
    analysis: ['gemini-2.5-pro', 'gemini-3-pro-preview', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    rewrite: ['gemini-2.5-pro', 'gemini-3-pro-preview', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    scoring: ['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  };

  const preferred = preferences[taskType] || preferences.analysis;

  // Filter to only models that are actually available, maintaining preference order
  const available = preferred.filter(m =>
    cachedModels.some(cached => cached.startsWith(m) || cached === m)
  );

  // Add any other available gemini models not in preference list
  const extras = cachedModels.filter(m =>
    !available.some(a => m.startsWith(a) || m === a) &&
    (m.includes('flash') || m.includes('pro'))
  );

  const result = [...available, ...extras];
  return result.length > 0 ? result : config.ai.models[taskType];
}

/**
 * Tracks rate-limited models and provides rotation logic
 */
const modelManager = {
  // Track when each model was rate-limited
  rateLimitedUntil: {},

  /**
   * Get the next available model from a list
   * @param {string[]} models - list of models to choose from
   * @returns {string} model name
   */
  getAvailableModel(models) {
    const now = Date.now();

    // Find first model that isn't rate-limited
    for (const model of models) {
      const cooldownUntil = this.rateLimitedUntil[model] || 0;
      if (now >= cooldownUntil) {
        return model;
      }
    }

    // All models are rate-limited, return the one with shortest remaining cooldown
    let bestModel = models[0];
    let shortestWait = Infinity;
    for (const model of models) {
      const remaining = (this.rateLimitedUntil[model] || 0) - now;
      if (remaining < shortestWait) {
        shortestWait = remaining;
        bestModel = model;
      }
    }
    return bestModel;
  },

  /**
   * Mark a model as rate-limited
   * @param {string} model - model name
   */
  markRateLimited(model) {
    this.rateLimitedUntil[model] = Date.now() + config.ai.rateLimitCooldown;
    console.log(`   ⚠️  ${model} rate-limited, cooling down for ${config.ai.rateLimitCooldown / 1000}s`);
  },

  /**
   * Check if error is a rate limit error
   * @param {Error} error
   * @returns {boolean}
   */
  isRateLimitError(error) {
    const msg = error.message?.toLowerCase() || '';
    return msg.includes('429') ||
           msg.includes('rate limit') ||
           msg.includes('quota') ||
           msg.includes('resource exhausted');
  },
};

/**
 * Execute AI request with automatic model rotation on rate limits
 * @param {GoogleGenerativeAI} genAI - initialized client
 * @param {string} prompt - the prompt to send
 * @param {string} taskType - 'analysis', 'rewrite', or 'scoring'
 * @param {string} stepName - for logging purposes
 * @returns {Promise<string>} response text
 */
async function executeWithRotation(genAI, prompt, taskType, stepName) {
  const models = await getModelsForTask(taskType);
  const triedModels = new Set();

  while (triedModels.size < models.length) {
    const modelName = modelManager.getAvailableModel(models);

    // Avoid infinite loop if we've tried all models
    if (triedModels.has(modelName)) {
      // Wait a bit and try again with the best available
      const waitTime = Math.min(
        ...models.map(m => Math.max(0, (modelManager.rateLimitedUntil[m] || 0) - Date.now()))
      );
      if (waitTime > 0) {
        console.log(`   ⏳ All models rate-limited, waiting ${Math.ceil(waitTime / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime + 1000));
      }
      triedModels.clear(); // Reset and try again
    }

    triedModels.add(modelName);

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 8192,
        },
      });

      console.log(`   🤖 Using model: ${modelName}`);
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      if (modelManager.isRateLimitError(error)) {
        modelManager.markRateLimited(modelName);
        console.log(`   🔄 Rotating to next available model...`);
      } else {
        // Non-rate-limit error, throw it
        throw error;
      }
    }
  }

  throw new Error(`All models exhausted for ${stepName}. Please wait and try again.`);
}

/**
 * Get current date for experience calculation
 */
function getCurrentDate() {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get all candidate skills
 */
function getAllSkills(resumeData) {
  return [
    ...resumeData.skills.frontend,
    ...resumeData.skills.backend,
    ...resumeData.skills.toolsDevOps,
    ...resumeData.skills.other,
  ];
}

// ============================================================
// STEP 1: KEYWORD EXTRACTION & GAP ANALYSIS
// ============================================================

function buildAnalysisPrompt(jobDescription, resumeData) {
  const allSkills = getAllSkills(resumeData);

  return `Extract ATS keywords FROM THE JD ONLY. Categorize by candidate's ability to claim them.

JOB DESCRIPTION:
${jobDescription}

CANDIDATE'S SKILLS: ${allSkills.join(', ')}

RULES (IMPORTANT):
- ONLY analyze keywords that appear IN THE JD
- exactMatch = JD keywords candidate definitely HAS
- canClaim = JD keywords candidate can claim via adjacent skills:
  * Express.js → can claim Fastify, Koa
  * React → can claim Next.js (and vice versa)
  * JWT → can claim OAuth, sessions, authentication
  * REST APIs → can claim API design, rate limiting
  * Async/await → can claim event-driven architecture
  * Backend dev → can claim background jobs, queues, caching
  * MongoDB → can claim NoSQL, document databases
  * SQL knowledge → can claim PostgreSQL, MySQL (only if candidate knows SQL)
- cannotClaim = NEVER claim these even if JD asks:
  * Cloud platforms are NOT interchangeable (AWS ≠ GCP ≠ Azure) - only claim what candidate knows
  * Cannot swap database categories (MongoDB ≠ PostgreSQL, NoSQL ≠ SQL)
  * Major platforms/tools require actual experience (Kubernetes, Terraform, etc.)
- DO NOT list candidate skills that aren't mentioned in JD

JSON only, MAX 8 items per array:
{"exactMatch":[],"canClaim":[],"cannotClaim":[],"keyPhrases":[],"missing":[]}`;
}

// ============================================================
// STEP 2: RESUME REWRITE
// ============================================================

function buildRewritePrompt(jobDescription, resumeData, analysis) {
  const currentDate = getCurrentDate();
  const allKeywords = [...(analysis.exactMatch || []), ...(analysis.canClaim || [])];

  return `Rewrite resume for ATS optimization. Current date: ${currentDate} (candidate started Aug 2023).

JOB TITLE FROM JD: ${jobDescription.split('\n')[0].substring(0, 100)}

MUST USE THESE KEYWORDS: ${allKeywords.join(', ')}

KEY PHRASES (use verbatim): ${(analysis.keyPhrases || []).join('; ')}

DO NOT USE: ${(analysis.cannotClaim || []).join(', ')}

CANDIDATE: ${resumeData.personalInfo.name}, ${resumeData.experience[0].title} at ${resumeData.experience[0].company}

PROJECT RULES (CRITICAL):
- Projects are MERN stack (MongoDB, Express, React, Node.js) - keep this consistent
- React ↔ Next.js swaps are OK (both React-based)
- MongoDB must stay MongoDB (do NOT replace with PostgreSQL/SQL)
- Do NOT add cloud platforms (GCP, Azure) that candidate doesn't know - only AWS is known
- Do NOT add major tools/platforms not in candidate's skills ,only try to use existing ones to make use of ATS phrases

OUTPUT JSON (no markdown):
{
  "summary": "250-350 chars, include role + years exp + key technologies",
  "bullets": ["120-180 chars each, 5 bullets total, spread keywords across all"],
  "skills": "comma-separated list of all claimable skills",
  "projectGetStatus": "136-255 chars with JD keywords, keep MERN stack",
  "projectBibico": "136-255 chars with JD keywords, keep MERN stack"
}`;
}

// ============================================================
// STEP 3: ATS SCORING & COMPARISON
// ============================================================

function buildScoringPrompt(jobDescription, rewrittenResume) {
  // Extract just first 500 chars of JD for comparison
  const jdShort = jobDescription.substring(0, 800);

  return `Score ATS match. Be CONCISE - max 5 items per array.

JD (shortened): ${jdShort}

RESUME:
${rewrittenResume.summary}
Skills: ${rewrittenResume.skills}

JSON only, keep arrays to MAX 5 items:
{"overallScore":85,"keywordCoverage":90,"phraseMatch":85,"found":["top5"],"missing":["top5"],"tips":["top3"]}`;
}

// ============================================================
// MAIN PIPELINE
// ============================================================

/**
 * Parse JSON response from AI
 */
function parseJSON(response, step = '') {
  let text = response.trim();

  // Remove markdown code blocks
  if (text.startsWith('```json')) text = text.slice(7);
  else if (text.startsWith('```')) text = text.slice(3);
  if (text.endsWith('```')) text = text.slice(0, -3);
  text = text.trim();

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`\n❌ JSON Parse Error in ${step}:`);
    console.error('Raw response (first 500 chars):');
    console.error(text.substring(0, 500));
    throw error;
  }
}

/**
 * Display Step 1 Analysis Results
 */
function displayAnalysis(analysis) {
  console.log('\n' + '─'.repeat(60));
  console.log('📊 STEP 1: KEYWORD ANALYSIS');
  console.log('─'.repeat(60));

  console.log('\n✅ EXACT MATCH (candidate has):');
  console.log('   ' + (analysis.exactMatch || []).join(', '));

  console.log('\n🔄 CAN CLAIM (adjacent skills):');
  console.log('   ' + (analysis.canClaim || []).join(', '));

  console.log('\n❌ CANNOT CLAIM (skip these):');
  console.log('   ' + (analysis.cannotClaim || []).join(', '));

  console.log('\n📝 KEY PHRASES (use verbatim):');
  (analysis.keyPhrases || []).forEach(p => console.log(`   • "${p}"`));

  console.log('\n⚠️  MISSING IN RESUME:');
  console.log('   ' + (analysis.missing || []).join(', '));
}

/**
 * Display Step 3 ATS Score
 */
function displayScore(score) {
  console.log('\n' + '─'.repeat(60));
  console.log('📈 STEP 3: ATS SCORE ANALYSIS');
  console.log('─'.repeat(60));

  const scoreEmoji = score.overallScore >= 90 ? '🟢' : score.overallScore >= 75 ? '🟡' : '🔴';

  console.log(`\n${scoreEmoji} OVERALL ATS SCORE: ${score.overallScore}%`);
  console.log(`   • Keyword Coverage: ${score.keywordCoverage || 'N/A'}%`);
  console.log(`   • Phrase Match:     ${score.phraseMatch || 'N/A'}%`);

  const found = score.found || score.keywordsFound || [];
  const missing = score.missing || score.keywordsMissing || [];
  const tips = score.tips || score.suggestions || [];

  console.log('\n✅ TOP KEYWORDS FOUND:');
  console.log('   ' + found.join(', '));

  if (missing.length > 0) {
    console.log('\n❌ KEYWORDS STILL MISSING:');
    console.log('   ' + missing.join(', '));
  } else {
    console.log('\n✅ NO MAJOR KEYWORDS MISSING!');
  }

  if (tips.length > 0) {
    console.log('\n💡 TIPS:');
    tips.forEach(s => console.log(`   • ${s}`));
  }

  console.log('\n' + '─'.repeat(60));
}

/**
 * Main 3-step tailoring pipeline
 * Uses model rotation to handle rate limits across different Gemini models
 */
export async function tailorResume(jobDescription, resumeData) {
  const genAI = initializeClient();

  // ========== STEP 1: Analysis ==========
  console.log('\n🔍 STEP 1: Analyzing JD keywords...');
  const analysisPrompt = buildAnalysisPrompt(jobDescription, resumeData);
  const analysisText = await executeWithRotation(genAI, analysisPrompt, 'analysis', 'Step 1 - Analysis');
  const analysis = parseJSON(analysisText, 'Step 1 - Analysis');
  displayAnalysis(analysis);

  // Log keyword gaps for later review
  const jobTitle = jobDescription.split('\n')[0];
  logKeywordGaps(jobTitle, analysis);

  // ========== STEP 2: Rewrite ==========
  console.log('\n✏️  STEP 2: Rewriting resume...');
  const rewritePrompt = buildRewritePrompt(jobDescription, resumeData, analysis);
  const rewriteText = await executeWithRotation(genAI, rewritePrompt, 'rewrite', 'Step 2 - Rewrite');
  const rewritten = parseJSON(rewriteText, 'Step 2 - Rewrite');
  console.log('   ✅ Resume rewritten with extracted keywords');

  // ========== STEP 3: Score ==========
  console.log('\n📈 STEP 3: Scoring ATS match...');
  const scorePrompt = buildScoringPrompt(jobDescription, rewritten);
  const scoreText = await executeWithRotation(genAI, scorePrompt, 'scoring', 'Step 3 - Score');
  const score = parseJSON(scoreText, 'Step 3 - Score');
  displayScore(score);

  // Validate rewritten content
  if (!rewritten.summary || !Array.isArray(rewritten.bullets) || rewritten.bullets.length < 4) {
    throw new Error('Invalid rewrite output');
  }

  return { ...rewritten, jdTitle: analysis.jdTitle || null };
}

export default { tailorResume };
