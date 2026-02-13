/**
 * Deterministic ATS Scoring Engine
 *
 * This module scores resumes against job descriptions using exact-match logic
 * similar to real Applicant Tracking Systems (ATS).
 *
 * NO AI is used here - all scoring is rule-based and deterministic.
 */

/**
 * Get current date formatted for experience calculations
 */
function getCurrentDate() {
  return new Date();
}

/**
 * Calculate years of experience from start date
 */
function calculateExperience(startDate) {
  const start = new Date(startDate);
  const now = getCurrentDate();
  const years = (now - start) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(years * 10) / 10; // Round to 1 decimal
}

/**
 * Calculate keyword match percentage
 * Compares JD required keywords vs what the candidate has
 *
 * ONLY counts "exactMatch" and "missing" as required keywords from JD
 * "canClaim" is NOT a JD requirement - it's candidate's related skills
 */
function calculateKeywordMatch(analysis, rewritten) {
  const jdKeywords = [
    ...(analysis.exactMatch || []),
    ...(analysis.missing || []),
  ];

  if (jdKeywords.length === 0) return 100; // No keywords to match

  // Extract all personal project descriptions dynamically
  const projectDescriptions = rewritten.projects
    ? Object.values(rewritten.projects).filter(Boolean)
    : [];

  // Extract all text from rewritten resume (including ALL personal projects dynamically)
  const resumeText = [
    rewritten.summary || '',
    rewritten.skills || '',
    ...(rewritten.bullets || []),
    ...projectDescriptions, // Include all personal project descriptions
  ].join(' ').toLowerCase();

  // Count how many JD keywords are found in resume
  const matchedKeywords = [];
  const missingKeywords = [];

  jdKeywords.forEach((keyword) => {
    // Extract actual keyword (remove explanations like "SSR (has Next.js)" → "SSR")
    const cleanKeyword = keyword.split('(')[0].trim();
    const kwLower = cleanKeyword.toLowerCase();

    if (resumeText.includes(kwLower)) {
      matchedKeywords.push(keyword);
    } else {
      missingKeywords.push(keyword);
    }
  });

  // Also check canClaim keywords (these are bonus, not required)
  const canClaimMatched = [];
  (analysis.canClaim || []).forEach((keyword) => {
    const cleanKeyword = keyword.split('(')[0].trim();
    const kwLower = cleanKeyword.toLowerCase();
    if (resumeText.includes(kwLower)) {
      canClaimMatched.push(keyword);
    }
  });

  const matchPercent = Math.round((matchedKeywords.length / jdKeywords.length) * 100);

  return {
    percent: matchPercent,
    matched: matchedKeywords,
    missing: missingKeywords,
    canClaimMatched: canClaimMatched, // Bonus keywords (not required)
    total: jdKeywords.length,
  };
}

/**
 * Check if resume title matches JD title
 * CRITICAL: For ATS, the resume title must match the JD title exactly
 */
function checkTitleMatch(jdTitle, resumeTitle) {
  if (!jdTitle || !resumeTitle) {
    return null; // Unknown
  }

  const jdTitleLower = jdTitle.toLowerCase().trim();
  const resumeTitleLower = resumeTitle.toLowerCase().trim();

  // Check for exact match (allowing for minor variations like punctuation)
  const exactMatch = jdTitleLower === resumeTitleLower;

  // Check if resume title contains JD title (allows for "Frontend Developer (React)" to match "Frontend Developer")
  const containsMatch = resumeTitleLower.includes(jdTitleLower);

  // For strict ATS matching, we want exact match
  return exactMatch || containsMatch;
}

/**
 * Check if language requirement matches candidate
 * Generic check based on candidate's actual skills
 */
function checkLanguageMatch(jdLang, candidateSkills) {
  if (!jdLang) return { match: true, reason: null }; // No language specified

  const jdLangLower = jdLang.toLowerCase().trim();

  // FIRST: Check if jdLang exists ANYWHERE in candidate's full skill list (direct match)
  // This handles cases like "Node.js", "Express.js", framework names, etc.
  const directMatch = candidateSkills.some(skill => {
    const skillLower = skill.toLowerCase();
    return (
      skillLower.includes(jdLangLower) ||
      jdLangLower.includes(skillLower) ||
      // Handle variations: "node.js" matches "node", "nodejs" matches "node.js", etc.
      (jdLangLower.replace(/[.\s-]/g, '') === skillLower.replace(/[.\s-]/g, ''))
    );
  });

  if (directMatch) {
    return { match: true, reason: null }; // Candidate has the exact skill!
  }

  // SECOND: If no direct match, check if it's a programming language mismatch
  // Extract programming languages from candidate's skills
  const candidateLanguages = candidateSkills
    .filter(skill => {
      const s = skill.toLowerCase();
      // Common programming language patterns (NOT runtimes/frameworks)
      return (
        s.includes('javascript') || s.includes('java') || s.includes('python') ||
        s.includes('typescript') || s.includes('go') || s.includes('golang') ||
        s.includes('rust') || s.includes('ruby') || s.includes('php') ||
        s.includes('c#') || s.includes('.net') || s.includes('c++') ||
        s.includes('swift') || s.includes('kotlin') || s.includes('scala')
      );
    })
    .map(s => s.toLowerCase());

  // Check if JD language is a programming language the candidate knows
  const langMatch = candidateLanguages.some(lang =>
    lang.includes(jdLangLower) || jdLangLower.includes(lang)
  );

  // Only hard reject if:
  // 1. No direct skill match (already checked above)
  // 2. It's clearly a programming language requirement
  // 3. Candidate doesn't have it
  if (!langMatch && candidateLanguages.length > 0) {
    // This is likely a language/framework/runtime candidate doesn't have
    return {
      match: false,
      reason: `JD requires ${jdLang} but candidate's primary stack is ${candidateLanguages.slice(0, 3).join(', ')}`,
    };
  }

  // If we get here, either:
  // - It's not a programming language requirement (might be a framework/tool)
  // - Or candidate doesn't list any programming languages (edge case)
  // Don't hard reject - let keyword matching handle it
  return { match: true, reason: null };
}

/**
 * Check if experience requirement is met
 */
function checkExperienceMatch(jdYears, candidateExpStart) {
  if (!jdYears || jdYears === null) return { match: true, gap: 0 }; // No experience specified

  const candidateYears = calculateExperience(candidateExpStart);
  const match = candidateYears >= jdYears;
  const gap = match ? 0 : jdYears - candidateYears;

  return { match, gap, candidateYears, requiredYears: jdYears };
}

/**
 * Main deterministic ATS scoring function
 *
 * @param {Object} analysis - Output from Step 1 (keyword analysis)
 * @param {Object} rewritten - Output from Step 2 (rewritten resume)
 * @param {Object} resumeData - Original resume data with candidate info
 * @returns {Object} ATS score with breakdown
 */
export function scoreResume(analysis, rewritten, resumeData) {
  // Extract candidate info
  const candidateExpStart = resumeData?.meta?.experienceStart || 'Unknown';

  // Get all candidate skills
  const skills = resumeData?.skills || {};
  const candidateSkills = [
    ...(skills.frontend || []),
    ...(skills.backend || []),
    ...(skills.toolsDevOps || []),
    ...(skills.databases || []),
    ...(skills.other || []),
  ].filter(Boolean);

  // Extract JD requirements from analysis
  const jdLang = analysis.jdLang || null;
  const jdYears = analysis.jdYears || null;
  const jdTitle = analysis.jdTitle || null;

  // ========== 1. KEYWORD MATCHING ==========
  const keywordMatch = calculateKeywordMatch(analysis, rewritten);

  // ========== 2. HARD GATES CHECKS ==========

  // Language Match
  const langCheck = checkLanguageMatch(jdLang, candidateSkills);
  const hardReject = !langCheck.match;

  // Experience Match
  const expCheck = checkExperienceMatch(jdYears, candidateExpStart);
  const expMatch = expCheck.match;

  // Title Match (compare resume title vs JD title)
  const resumeTitle = rewritten.title || rewritten.summary?.split('.')[0] || '';
  const titleMatch = checkTitleMatch(jdTitle, resumeTitle);

  // ========== 3. SCORE CALCULATION ==========
  let finalScore = keywordMatch.percent;

  const penalties = [];

  // HARD REJECT: Language mismatch → cap at 40
  if (hardReject) {
    finalScore = Math.min(finalScore, 40);
    penalties.push(`Hard reject: ${langCheck.reason} → capped at 40`);
  }

  // Experience gap → -10 points
  if (!expMatch) {
    finalScore = Math.max(0, finalScore - 10);
    penalties.push(
      `Experience gap (need ${expCheck.requiredYears}y, have ${expCheck.candidateYears}y) → -10 points`
    );
  }

  // Title mismatch → -15 points
  if (titleMatch === false) {
    finalScore = Math.max(0, finalScore - 15);
    penalties.push(`Title mismatch → -15 points`);
  }

  // ========== 4. BUILD RESPONSE ==========
  return {
    // Final score
    overallScore: Math.round(finalScore),
    keywordExact: keywordMatch.percent,

    // Keyword breakdown
    found: keywordMatch.matched,
    missing: keywordMatch.missing,
    canClaimMatched: keywordMatch.canClaimMatched || [], // Bonus keywords
    totalKeywords: keywordMatch.total,

    // Hard gates
    titleMatch: titleMatch,
    expMatch: expMatch,
    hardReject: hardReject,
    rejectReason: hardReject ? langCheck.reason : null,

    // Penalties applied
    penalties: penalties,

    // JD requirements detected
    jdLang: jdLang,
    jdYears: jdYears,
    jdTitle: jdTitle,

    // Experience details
    experienceDetails: {
      candidateYears: expCheck.candidateYears,
      requiredYears: expCheck.requiredYears || null,
      gap: expCheck.gap,
    },
  };
}

export default { scoreResume };
