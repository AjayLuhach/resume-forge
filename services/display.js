/**
 * Shared Display Service
 *
 * Console display functions for analysis results and ATS scores.
 * Used by both the AI pipeline and the Claude Code generate script.
 */

/**
 * Display keyword analysis results
 */
export function displayAnalysis(analysis) {
  console.log("\n" + "\u2500".repeat(60));
  console.log("STEP 1: KEYWORD ANALYSIS (Exact-Match Mode)");
  console.log("\u2500".repeat(60));

  if (analysis.jdLang || analysis.jdYears || analysis.jdTitle) {
    console.log("\n\ud83d\udccb JD REQUIREMENTS:");
    if (analysis.jdTitle) console.log(`   Title: ${analysis.jdTitle}`);
    if (analysis.jdCompany) console.log(`   Company: ${analysis.jdCompany}`);
    if (analysis.jdLang) console.log(`   Primary Language: ${analysis.jdLang}`);
    if (analysis.jdYears) console.log(`   Years Required: ${analysis.jdYears}`);
  }

  const c = analysis.contact || {};
  if (c.name || c.email || c.phone || c.link || c.applyUrl || c.instructions) {
    console.log("\n\ud83d\udced SEND RESUME TO:");
    if (c.name) console.log(`   Name:  ${c.name}`);
    if (c.email) console.log(`   Email: ${c.email}`);
    if (c.phone) console.log(`   Phone: ${c.phone}`);
    if (c.link) console.log(`   Link:  ${c.link}`);
    if (c.applyUrl) console.log(`   Apply: ${c.applyUrl}`);
    if (c.instructions) console.log(`   \ud83d\udcdd ${c.instructions}`);
  }

  console.log("\n\u2705 EXACT MATCH (candidate has):");
  console.log("   " + (analysis.exactMatch || []).join(", ") || "none");

  console.log("\n\ud83d\udd04 CAN CLAIM (for rewrite only):");
  console.log("   " + (analysis.canClaim || []).join(", ") || "none");

  console.log("\n\ud83d\udeab CANNOT CLAIM (different stack):");
  console.log("   " + (analysis.cannotClaim || []).join(", ") || "none");

  console.log("\n\ud83d\udcdd KEY PHRASES:");
  (analysis.keyPhrases || []).forEach((p) => console.log(`   - "${p}"`));

  console.log("\n\u274c MISSING (required but lacks):");
  console.log("   " + (analysis.missing || []).join(", ") || "none");
}

/**
 * Display ATS score breakdown
 */
export function displayScore(score) {
  console.log("\n" + "\u2500".repeat(60));
  console.log("STEP 3: ATS SCORE (Deterministic)");
  console.log("\u2500".repeat(60));

  const emoji =
    score.overallScore >= 70
      ? "\ud83d\udfe2"
      : score.overallScore >= 50
        ? "\ud83d\udfe1"
        : "\ud83d\udd34";
  console.log(`\n${emoji} FINAL SCORE: ${score.overallScore}%`);
  console.log(`   Keyword Exact Match: ${score.keywordExact}%`);

  console.log("\n\ud83d\udcca HARD GATES:");
  console.log(
    `   Title Match:      ${score.titleMatch === true ? "\u2705 Yes" : score.titleMatch === false ? "\u274c No" : "\u26a0\ufe0f  Unknown"}`,
  );
  console.log(
    `   Experience Match: ${score.expMatch === true ? "\u2705 Yes" : score.expMatch === false ? "\u274c No" : "\u26a0\ufe0f  Unknown"}`,
  );
  console.log(
    `   Hard Reject:      ${score.hardReject === true ? "\ud83d\udeab YES" : "\u2705 No"}`,
  );

  if (score.hardReject && score.rejectReason) {
    console.log(`\n\ud83d\udeab REJECT REASON: ${score.rejectReason}`);
  }

  if (score.penalties && score.penalties.length > 0) {
    console.log("\n\u26a0\ufe0f  PENALTIES APPLIED:");
    score.penalties.forEach((p) => console.log(`   - ${p}`));
  }

  if (score.jdLang || score.jdYears) {
    console.log("\n\ud83d\udccb JD REQUIREMENTS DETECTED:");
    if (score.jdLang) console.log(`   Primary Language: ${score.jdLang}`);
    if (score.jdYears) console.log(`   Years Required: ${score.jdYears}`);
  }

  console.log("\n\u2705 JD KEYWORDS MATCHED:");
  console.log("   " + (score.found || []).join(", ") || "none");

  if ((score.canClaimMatched || []).length > 0) {
    console.log("\n\ud83c\udf81 BONUS KEYWORDS (related skills used):");
    console.log("   " + score.canClaimMatched.join(", "));
  }

  if ((score.missing || []).length > 0) {
    console.log("\n\u274c JD KEYWORDS MISSING:");
    console.log("   " + score.missing.join(", "));
  }

  console.log("\n" + "\u2500".repeat(60));
}

export default { displayAnalysis, displayScore };
