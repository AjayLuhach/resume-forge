/**
 * Shared Logging Service
 *
 * Centralized logging for keyword gaps and resume history.
 * Used by both the AI pipeline and the Claude Code generate script.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = path.join(__dirname, "..", "logs");
const KEYWORD_LOG = path.join(LOG_DIR, "keyword_gaps.json");
const RESUME_LOG = path.join(LOG_DIR, "resume_history.json");

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Log keyword gaps (cannotClaim + missing) for trend analysis
 */
export function logKeywordGaps(jobTitle, analysis) {
  const cannotClaim = analysis.cannotClaim || [];
  const missing = analysis.missing || [];
  if (cannotClaim.length === 0 && missing.length === 0) return;

  ensureLogDir();

  let log = { entries: [], summary: {} };
  if (fs.existsSync(KEYWORD_LOG)) {
    try {
      log = JSON.parse(fs.readFileSync(KEYWORD_LOG, "utf-8"));
    } catch {
      log = { entries: [], summary: {} };
    }
  }

  log.entries.push({
    date: new Date().toISOString(),
    jobTitle: (jobTitle || "").substring(0, 100),
    cannotClaim,
    missing,
  });

  [...cannotClaim, ...missing].forEach((kw) => {
    const key = kw.toLowerCase().trim();
    log.summary[key] = (log.summary[key] || 0) + 1;
  });

  fs.writeFileSync(KEYWORD_LOG, JSON.stringify(log, null, 2));
}

/**
 * Log resume generation history for audit trail
 */
export function logResumeHistory(analysis, rewritten, score, modelId) {
  ensureLogDir();

  let history = [];
  if (fs.existsSync(RESUME_LOG)) {
    try {
      history = JSON.parse(fs.readFileSync(RESUME_LOG, "utf-8"));
    } catch {
      history = [];
    }
  }

  history.push({
    date: new Date().toISOString(),
    model: modelId || "unknown",
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

export default { logKeywordGaps, logResumeHistory };
