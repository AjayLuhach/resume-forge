/**
 * AWS Bedrock AI Service - Resume Forgeing
 *
 * STEP 1: ANALYSIS - Claude Haiku 4.5
 * - Keyword categorization (exact/claim/miss)
 * - JD requirement extraction
 *
 * STEP 2: REWRITE - Claude Haiku 4.5
 * - Resume content generation
 *
 * STEP 3: SCORING - Deterministic (No AI)
 * - Rule-based ATS scoring
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { logApiCall, displayCostSummary } from "./cost-logger.js";
import { scoreResume } from "./ats-scorer.js";
import config from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "keyword_gaps.json");

// ============================================================
// CONFIGURATION
// ============================================================

const BEDROCK_CONFIG = {
  region: config.ai.bedrock.region || process.env.AWS_REGION || "us-east-1",

  // Multi-model configuration
  models: {
    analysis: {
      modelId: config.ai.bedrock.models.analysis.modelId,
      maxTokens: config.ai.bedrock.models.analysis.maxTokens,
      anthropicVersion: "bedrock-2023-05-31", // Claude-specific
    },
    rewrite: {
      modelId: config.ai.bedrock.models.rewrite.modelId,
      maxTokens: config.ai.bedrock.models.rewrite.maxTokens,
      anthropicVersion: "bedrock-2023-05-31", // Claude-specific
    },
  },
};

// ============================================================
// BEDROCK CLIENT
// ============================================================

let bedrockClient = null;

function getBedrockClient() {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: BEDROCK_CONFIG.region,
      // AWS credentials from environment or IAM role
      // AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, or instance profile
    });
  }
  return bedrockClient;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Get current date formatted for prompts
 */
function getCurrentDate() {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Calculate years of experience from start date
 */
function calculateExperience(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const years = (now - start) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(years * 10) / 10; // Round to 1 decimal
}

function buildSystemPrompt(resumeData) {
  const expStart = resumeData.meta?.experienceStart || "Unknown";

  return `You are an ATS optimization expert. Analyze job descriptions and tailor resumes based on candidate's actual experience.

CANDIDATE INFO:
- Started work: ${expStart}
- Full resume provided in JSON format (skills, experience, projects with core technologies used)

KEYWORD ANALYSIS RULES (CRITICAL):
- 🔍 ALWAYS check the full resume JSON (skills arrays + project coreTech) FIRST before categorizing
- exact = candidate DEFINITELY has this (in skills OR used in actual projects - match flexibly: "React.js" = "React")
- claim = ONLY naming variations OR direct sub-concepts (e.g., has "Next.js" → claim "SSR")
- no = different tech in same category (MongoDB ≠ Cassandra, WebSockets ≠ Kafka, Express.js ≠ Sequelize)
- CRITICAL: Different databases, ORMs, message queues, frameworks = CANNOT claim (e.g., MongoDB ≠ Cassandra) 

REWRITING RULES:
- Only use skills and core technologies the candidate actually knows
- Don't add skills the candidate doesn't have
- Keep the candidate's core tech stack consistent
- Be honest about skill gaps - don't fabricate experience

SCORING RULES:
- Check if JD's primary language/framework matches candidate's skills
- Hard mismatches (e.g., Java job for JavaScript developer) should be flagged
- Be transparent about fundamental skill gaps

OUTPUT: Always respond with ONLY valid JSON, no markdown, no explanation.`;
}

/**
 * Build full resume context from resumeData.json
 * Pass the complete structured resume to AI for better context
 */
function buildResumeContext(resumeData) {
  return `CANDIDATE'S FULL RESUME (JSON format):
${JSON.stringify(resumeData, null, 2)}`;
}

// ============================================================
// OPTIMIZED PROMPTS (Minimal output tokens)
// ============================================================

function buildAnalysisPrompt(jobDescription, resumeData) {
  const expStart = resumeData?.meta?.experienceStart || "Unknown";
  const yearsExp = expStart !== "Unknown" ? calculateExperience(expStart) : 0;

  return `CURRENT DATE: ${getCurrentDate()}
CANDIDATE EXPERIENCE: ${yearsExp} years (since ${expStart})

JOB DESCRIPTION:
${jobDescription.substring(0, 4000)}

EXTRACTION RULES:

1. KEYWORD EXTRACTION - CRITICAL RULES:
   ⚠️ ONLY extract keywords that are EXPLICITLY WRITTEN in the job description
   ⚠️ DO NOT infer or guess specific technologies from generic terms

   EXAMPLES OF CORRECT EXTRACTION:
   • JD says "JavaScript frameworks" → extract "JavaScript frameworks" (NOT "React.js" or "Angular")
   • JD says "databases" → extract "databases" (NOT "MongoDB" or "PostgreSQL")
   • JD says "React.js" → extract "React.js" ✅
   • JD says "MongoDB" → extract "MongoDB" ✅

   - Extract keywords EXACTLY as written from jobDescription (preserve "Next.js" not "NextJS", "Node.js" not "nodejs")
   - Include: Technical skills, soft skills, process/methodologies, tools
   - Skip: Vague phrases ("good communication"), job structure terms, company benefits

2. CROSS-REFERENCE with candidate's FULL RESUME (provided above in JSON format):
   - Check: resumeData.skills (frontend, backend, toolsDevOps, databases, other)
   - Check: resumeData.experience[].projects[].coreTech (core differentiating technologies from work projects)
   - Check: resumeData.projects[].coreTech (core technologies from personal projects)

   - exact: Candidate HAS this SPECIFIC skill that was EXPLICITLY mentioned in JD
     • Example: JD says "React.js" AND candidate has "React" → exact match ✅
     • Example: JD says "JavaScript frameworks" AND candidate has "React" → DO NOT mark as exact, this is a claim ⚠️

   - claim: Use this for TWO cases ONLY:

     CASE 1: Naming variations (same tech, different name)
     ✅ JD says "React.js", candidate has "React" → claim "React.js"
     ✅ JD says "Node", candidate has "Node.js" → claim "Node"

     CASE 2: Generic term in JD, candidate has specific implementation
     ✅ JD says "JavaScript frameworks", candidate has "React, Next.js" → claim "JavaScript frameworks"
     ✅ JD says "databases", candidate has "MongoDB, PostgreSQL" → claim "databases"

     ❌ NEVER CLAIM:
     • Has "MongoDB" → CANNOT claim "Cassandra", "DynamoDB" (different DBs)
     • Has "WebSockets/Socket.io" → CANNOT claim "Kafka", "RabbitMQ", "message queues" (different tech)
     • Has "Express.js" → CANNOT claim "NestJS", "Fastify", "Koa" (different frameworks)
     • Has "AWS" → CANNOT claim "Azure", "GCP" (different cloud providers)
     • Has "React" → CANNOT claim "Angular", "Vue.js" (different frameworks)

   - no: Different tech in same category (put them here, NOT in "claim")
   - miss: Critical requirements candidate lacks

3. JD REQUIREMENTS:
   - jdLang: Primary programming language
   - jdYears: Years required (number or null)
   - jdTitle: Exact job title
   - jdCompany: Company name (or null)
   - requiredSkills: Top 7-10 must-have skills (technical + soft skills + methodologies)
   - niceToHave: Optional skills
   - phrases: 3-5 SHORT action phrases
   - contact: Recruiter/hiring manager details if present

4. RESUME CONTEXT (for Step 2 rewrite - extract from candidate's full resume JSON):
   - candidateTech: Candidate's primary tech stack (e.g., "Node.js/React.js/MongoDB")
   - relevantProjects: List of 2-3 most relevant work project names + core technologies from resumeData.experience[].projects[]
   - personalProjects: List of personal project names from resumeData.projects[]

Return ONLY valid JSON:
{
  "exact": ["skills candidate has"],
  "claim": ["close variations/related concepts"],
  "no": ["skills candidate lacks"],
  "phrases": ["key JD phrases"],
  "miss": ["missing required skills"],
  "jdLang": "primary language",
  "jdYears": number or null,
  "jdTitle": "job title",
  "jdCompany": "company name or null",
  "requiredSkills": ["top required skills"],
  "niceToHave": ["optional skills"],
  "candidateTech": "primary tech stack from resume",
  "relevantProjects": [{"name": "project name", "tech": ["tech1", "tech2"]}],
  "personalProjects": ["project1", "project2"],
  "contact": {
    "name": "name or null",
    "email": "email or null",
    "phone": "phone or null"
  }
}`;
}

function buildRewritePrompt(jobDescription, analysis, resumeData) {
  const keywords = [...(analysis.exact || []), ...(analysis.claim || [])];
  const expStart = resumeData.meta?.experienceStart || "Unknown";
  const yearsExp = expStart !== "Unknown" ? calculateExperience(expStart) : 0;

  const phrases = (analysis.phrases || []).slice(0, 5);
  const jdTitle =
    analysis.jdTitle || jobDescription.split("\n")[0].substring(0, 100);

  // Use candidate tech from analysis output (Step 1 already extracted this)
  const primaryTech = analysis.candidateTech || "Full Stack";

  // Use relevant projects from analysis output (Step 1 already selected these)
  const relevantProjects = analysis.relevantProjects || [];

  // Use personal projects directly from resumeData (more reliable than analysis output)
  const personalProjects = (resumeData.projects || []).map((p) => p.name);

  // Build project lists from analysis output
  const projectsList = relevantProjects
    .map((proj, idx) => {
      const techSample = proj.tech.slice(0, 6).join(", ");
      return `  ${idx + 1}. ${proj.name}: ${techSample}`;
    })
    .join("\n");

  return `CURRENT DATE: ${getCurrentDate()}
CANDIDATE EXPERIENCE: ${yearsExp} years
CANDIDATE PRIMARY TECH: ${primaryTech}

⚠️ STEP 1 ANALYSIS ALREADY COMPLETED - Use the analyzed keywords below:

KEYWORDS TO USE (from Step 1 analysis - use EXACT formatting):
✅ EXACT MATCH: ${keywords.slice(0, 30).join(", ")}
🚫 DO NOT USE: ${(analysis.no || []).slice(0, 15).join(", ")}

CRITICAL: Use keywords EXACTLY as listed above (preserve "Next.js" not "NextJS", "Node.js" not "nodejs", etc.)

Rewrite resume content to match this job description while staying truthful to candidate's skills.

JOB TITLE: ${jdTitle}

TITLE GENERATION (CRITICAL FOR ATS RANKING):
- Use EXACTLY this title: "${jdTitle}"
- DO NOT add parentheses, tech stack, or any modifications
- DO NOT change any words or add descriptors
- The title MUST be identical to the JD title for ATS matching

Examples:
  * JD: "Frontend Developer" → Title: "Frontend Developer" (NOT "Frontend Developer (React)")

WORK PROJECTS (from analysis - already selected by Step 1):
${projectsList}

EXPERIENCE BULLETS STRUCTURE (CRITICAL):
- Write 5 experience bullets (120-180 chars each)
- AT LEAST 2 bullets MUST explicitly mention work projects from the list above BY NAME
- Example: "Built GetStatus platform using React, Node.js, MongoDB with real-time WebSocket features and CloudWatch monitoring"
- Remaining bullets can be general achievements or mention other work

PERSONAL PROJECTS SECTION (CRITICAL - from analysis output):
You MUST rewrite ${personalProjects.length} personal project descriptions to maximize ATS keyword coverage:
- Personal projects: ${personalProjects.join(", ")}
- Each description should be 130-250 chars
- INJECT JD keywords into these descriptions wherever truthful
- These are SEPARATE from work experience - they go in "Projects" section

CONTENT RULES:
- Use keywords from "EXACT MATCH" list above (already extracted by Step 1)
- Weave in these JD phrases naturally: ${phrases.join("; ")}
- Only mention core technologies the candidate actually knows
- Be honest about experience level and capabilities

Return ONLY valid JSON (no markdown):
{
  "title": "professional title matching JD (max 60 chars)",
  "sum": "professional summary 250-350 chars",
  "bul": ["5 experience bullets, 120-180 chars each - AT LEAST 2 must mention work projects by name"],
  "skl": "comma-separated skills matching JD",
  ${personalProjects
    .map((projectName) => {
      const key = projectName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      return `"${key}": "${projectName} description 130-250 chars (inject JD keywords)"`;
    })
    .join(",\n  ")},
  "projectsUsed": ["names of work projects mentioned in bullets"]
}`;
}

// ============================================================
// NOTE: Scoring prompt removed - Step 3 is now fully deterministic
// See services/ats-scorer.js for the deterministic scoring logic
// ============================================================

// ============================================================
// BEDROCK API CALLS
// ============================================================

/**
 * Invoke Bedrock model with step-specific configuration
 * Supports Claude (Anthropic Messages API format)
 */
async function invoke(systemPrompt, messages, stepName = "unknown") {
  const client = getBedrockClient();
  const modelConfig = BEDROCK_CONFIG.models[stepName];

  if (!modelConfig) {
    throw new Error(`Unknown step: ${stepName}. Use 'analysis' or 'rewrite'`);
  }

  const isClaude = modelConfig.modelId.includes("anthropic");

  if (!isClaude) {
    throw new Error(`Unsupported model: ${modelConfig.modelId}`);
  }

  // Claude Anthropic Messages API format
  const payload = {
    anthropic_version: modelConfig.anthropicVersion,
    max_tokens: modelConfig.maxTokens,
    temperature: 0.1,
    system: systemPrompt,
    messages,
  };

  const command = new InvokeModelCommand({
    modelId: modelConfig.modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload),
  });

  try {
    const response = await client.send(command);
    const result = JSON.parse(Buffer.from(response.body).toString());

    // Log usage if available
    if (result.usage) {
      logApiCall(stepName, result.usage, modelConfig.modelId);
    }

    // Extract response text from Claude format
    return result.content[0].text;
  } catch (error) {
    console.error(`Bedrock API error (${stepName}):`, error.message);
    throw error;
  }
}

// ============================================================
// JSON PARSING
// ============================================================

function parseJSON(response, step = "") {
  let text = response.trim();

  // Remove markdown code blocks if present
  if (text.startsWith("```json")) text = text.slice(7);
  else if (text.startsWith("```")) text = text.slice(3);
  if (text.endsWith("```")) text = text.slice(0, -3);
  text = text.trim();

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`\nJSON Parse Error in ${step}:`);
    console.error("Raw response (first 500 chars):");
    console.error(text.substring(0, 500));
    throw error;
  }
}

// ============================================================
// OUTPUT EXPANSION (Abbreviated -> Full format)
// ============================================================

/**
 * Expand abbreviated response to full format
 * We use short keys to save output tokens, then expand for compatibility
 */
function expandRewriteResponse(abbreviated, resumeData) {
  // Build personal project mapping dynamically from resumeData.json (these go in Projects section)
  const personalProjects = {};
  const projectDescriptions = {};

  (resumeData.projects || []).forEach((project) => {
    const key = project.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const projectName = project.name;

    personalProjects[projectName] = abbreviated[key] || "";
    projectDescriptions[key] = abbreviated[key] || "";
  });

  // Track which work projects were used (these are mentioned in experience bullets)
  const projectsUsed = abbreviated.projectsUsed || [];

  return {
    title: abbreviated.title || "Software Developer",
    summary: abbreviated.sum || "",
    bullets: abbreviated.bul || [],
    skills: abbreviated.skl || "",
    projects: personalProjects, // Personal projects only (dynamic)
    projectsUsed: projectsUsed, // Work projects mentioned in bullets
    // Personal project descriptions (dynamic keys)
    ...projectDescriptions,
  };
}

function expandAnalysisResponse(abbreviated) {
  return {
    exactMatch: abbreviated.exact || [],
    canClaim: abbreviated.claim || [],
    cannotClaim: abbreviated.no || [],
    keyPhrases: abbreviated.phrases || [],
    missing: abbreviated.miss || [],
    // JD requirements
    jdLang: abbreviated.jdLang || null,
    jdYears: abbreviated.jdYears || null,
    jdTitle: abbreviated.jdTitle || null,
    jdCompany: abbreviated.jdCompany || null,
    requiredSkills: abbreviated.requiredSkills || [],
    niceToHave: abbreviated.niceToHave || [],
    contact: abbreviated.contact || { name: null, email: null, phone: null },
    // Resume context for Step 2 (extracted from full resume)
    candidateTech: abbreviated.candidateTech || "Full Stack",
    relevantProjects: abbreviated.relevantProjects || [],
    personalProjects: abbreviated.personalProjects || [],
  };
}

// LOGGING

function logKeywordGaps(jobTitle, analysis) {
  const cannotClaim = analysis.cannotClaim || [];
  const missing = analysis.missing || [];

  if (cannotClaim.length === 0 && missing.length === 0) return;

  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  let log = { entries: [], summary: {} };
  if (fs.existsSync(LOG_FILE)) {
    try {
      log = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
    } catch (e) {
      log = { entries: [], summary: {} };
    }
  }

  const entry = {
    date: new Date().toISOString(),
    jobTitle: jobTitle.substring(0, 100),
    cannotClaim,
    missing,
  };
  log.entries.push(entry);

  [...cannotClaim, ...missing].forEach((keyword) => {
    const key = keyword.toLowerCase().trim();
    log.summary[key] = (log.summary[key] || 0) + 1;
  });

  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

const RESUME_LOG = path.join(LOG_DIR, "resume_history.json");

function logResumeHistory(analysis, rewritten, score) {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  let history = [];
  if (fs.existsSync(RESUME_LOG)) {
    try {
      history = JSON.parse(fs.readFileSync(RESUME_LOG, "utf-8"));
    } catch (e) {
      history = [];
    }
  }

  history.push({
    date: new Date().toISOString(),
    job: {
      title: analysis.jdTitle || null,
      company: analysis.jdCompany || null,
      language: analysis.jdLang || null,
      yearsRequired: analysis.jdYears || null,
      contact: analysis.contact || null,
    },
    score: {
      final: score.overallScore,
      keywordExact: score.keywordExact,
      hardReject: score.hardReject,
      penalties: score.penalties,
    },
    resume: {
      summary: rewritten.summary,
      skills: rewritten.skills,
      bullets: rewritten.bullets,
      projects: rewritten.projects || {},
      projectsUsed: rewritten.projectsUsed || [],
    },
    keywords: {
      matched: score.found,
      missing: score.missing,
    },
  });

  fs.writeFileSync(RESUME_LOG, JSON.stringify(history, null, 2));
}

// ============================================================
// DISPLAY FUNCTIONS
// ============================================================

function displayAnalysis(analysis) {
  console.log("\n" + "─".repeat(60));
  console.log("STEP 1: KEYWORD ANALYSIS (Exact-Match Mode)");
  console.log("─".repeat(60));

  // JD Requirements detected
  if (analysis.jdLang || analysis.jdYears || analysis.jdTitle) {
    console.log("\n📋 JD REQUIREMENTS:");
    if (analysis.jdTitle) console.log(`   Title: ${analysis.jdTitle}`);
    if (analysis.jdCompany) console.log(`   Company: ${analysis.jdCompany}`);
    if (analysis.jdLang) console.log(`   Primary Language: ${analysis.jdLang}`);
    if (analysis.jdYears) console.log(`   Years Required: ${analysis.jdYears}`);
  }

  const c = analysis.contact || {};
  if (c.name || c.email || c.phone) {
    console.log("\n📬 SEND RESUME TO:");
    if (c.name) console.log(`   Name:  ${c.name}`);
    if (c.email) console.log(`   Email: ${c.email}`);
    if (c.phone) console.log(`   Phone: ${c.phone}`);
  }

  console.log("\n✅ EXACT MATCH (candidate has):");
  console.log("   " + (analysis.exactMatch || []).join(", ") || "none");

  console.log("\n🔄 CAN CLAIM (for rewrite only):");
  console.log("   " + (analysis.canClaim || []).join(", ") || "none");

  console.log("\n🚫 CANNOT CLAIM (different stack):");
  console.log("   " + (analysis.cannotClaim || []).join(", ") || "none");

  console.log("\n📝 KEY PHRASES:");
  (analysis.keyPhrases || []).forEach((p) => console.log(`   - "${p}"`));

  console.log("\n❌ MISSING (required but lacks):");
  console.log("   " + (analysis.missing || []).join(", ") || "none");
}

function displayScore(score) {
  console.log("\n" + "─".repeat(60));
  console.log("STEP 3: ATS SCORE (Deterministic)");
  console.log("─".repeat(60));

  // Final score with emoji
  const scoreEmoji =
    score.overallScore >= 70 ? "🟢" : score.overallScore >= 50 ? "🟡" : "🔴";
  console.log(`\n${scoreEmoji} FINAL SCORE: ${score.overallScore}%`);
  console.log(`   Keyword Exact Match: ${score.keywordExact}%`);

  // Hard gates status
  console.log("\n📊 HARD GATES:");
  console.log(
    `   Title Match:      ${score.titleMatch === true ? "✅ Yes" : score.titleMatch === false ? "❌ No" : "⚠️  Unknown"}`,
  );
  console.log(
    `   Experience Match: ${score.expMatch === true ? "✅ Yes" : score.expMatch === false ? "❌ No" : "⚠️  Unknown"}`,
  );
  console.log(
    `   Hard Reject:      ${score.hardReject === true ? "🚫 YES" : "✅ No"}`,
  );

  // Show reject reason if applicable
  if (score.hardReject && score.rejectReason) {
    console.log(`\n🚫 REJECT REASON: ${score.rejectReason}`);
  }

  // Penalties applied
  if (score.penalties && score.penalties.length > 0) {
    console.log("\n⚠️  PENALTIES APPLIED:");
    score.penalties.forEach((p) => console.log(`   - ${p}`));
  }

  // JD requirements detected
  if (score.jdLang || score.jdYears) {
    console.log("\n📋 JD REQUIREMENTS DETECTED:");
    if (score.jdLang) console.log(`   Primary Language: ${score.jdLang}`);
    if (score.jdYears) console.log(`   Years Required: ${score.jdYears}`);
  }

  // Keywords found
  console.log("\n✅ JD KEYWORDS MATCHED:");
  console.log("   " + (score.found || []).join(", ") || "none");

  // Bonus keywords (canClaim that were used)
  if ((score.canClaimMatched || []).length > 0) {
    console.log("\n🎁 BONUS KEYWORDS (related skills used):");
    console.log("   " + score.canClaimMatched.join(", "));
  }

  // Keywords missing
  if ((score.missing || []).length > 0) {
    console.log("\n❌ JD KEYWORDS MISSING:");
    console.log("   " + score.missing.join(", "));
  }

  console.log("\n" + "─".repeat(60));
}

// ============================================================
// MAIN PIPELINE
// ============================================================

export async function tailorResume(jobDescription, resumeData) {
  const systemPrompt = buildSystemPrompt(resumeData);
  const resumeContext = buildResumeContext(resumeData);

  // ========== STEP 1: Analysis (Claude Haiku 4.5) ==========
  console.log("\nSTEP 1: Analyzing JD keywords (Claude Haiku 4.5)...");

  const analysisMessages = [
    {
      role: "user",
      content: `${resumeContext}\n\n${buildAnalysisPrompt(jobDescription, resumeData)}`,
    },
  ];

  const analysisText = await invoke(systemPrompt, analysisMessages, "analysis");
  const analysisRaw = parseJSON(analysisText, "Step 1 - Analysis");
  const analysis = expandAnalysisResponse(analysisRaw);
  displayAnalysis(analysis);

  const jobTitle = jobDescription.split("\n")[0];
  logKeywordGaps(jobTitle, analysis);

  // ========== STEP 2: Rewrite (Claude Haiku 4.5) ==========
  console.log("\nSTEP 2: Rewriting resume (Claude Haiku 4.5)...");

  const rewriteMessages = [
    {
      role: "user",
      content: buildRewritePrompt(jobDescription, analysisRaw, resumeData),
    },
  ];

  const rewriteText = await invoke(systemPrompt, rewriteMessages, "rewrite");
  const rewriteRaw = parseJSON(rewriteText, "Step 2 - Rewrite");
  const rewritten = expandRewriteResponse(rewriteRaw, resumeData);

  // Dynamically show selected work projects (referenced in experience bullets)
  console.log(`   Resume rewritten with extracted keywords`);
  const projectsUsed = rewritten.projectsUsed || [];
  console.log(
    `   📂 Work projects referenced in bullets: ${projectsUsed.join(", ")}`,
  );
  const personalProjectNames = (resumeData.projects || [])
    .map((p) => p.name)
    .join(", ");
  console.log(`   📝 Personal projects rewritten: ${personalProjectNames}`);

  // ========== STEP 3: Score (Deterministic - No AI) ==========
  console.log("\nSTEP 3: Scoring ATS match (deterministic - no AI)...");

  // Use deterministic ATS scorer (no AI call)
  const score = scoreResume(analysis, rewritten, resumeData);
  displayScore(score);

  if (
    !rewritten.summary ||
    !Array.isArray(rewritten.bullets) ||
    rewritten.bullets.length < 4
  ) {
    throw new Error("Invalid rewrite output");
  }

  logResumeHistory(analysis, rewritten, score);
  displayCostSummary();
  return {
    ...rewritten,
    jdTitle: analysis.jdTitle || null,
    contact: analysis.contact,
  };
}

export default { tailorResume };
