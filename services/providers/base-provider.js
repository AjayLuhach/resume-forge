/**
 * Base AI Provider
 *
 * Shared logic for all AI providers: pipeline orchestration,
 * response expansion, and JSON parsing.
 *
 * Prompts live in prompts.js — edit them there.
 *
 * To add a new provider, extend this class and implement:
 *   - invoke(systemPrompt, messages, stepName) → raw text response
 *   - getModelLabel() → display name for logging
 *
 * See bedrock.js or gemini.js for examples.
 */

import { scoreResume } from "../pipeline/ats-scorer.js";
import { logKeywordGaps, logResumeHistory } from "../logging.js";
import { displayAnalysis, displayScore } from "../display.js";
import { displayCostSummary } from "../cost-logger.js";
import { logContactDetails } from "../outreach/contact-logger.js";
import * as prompts from "../pipeline/prompts.js";

export class BaseProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Override in subclass: send prompt to AI and return raw text
   * @param {string} systemPrompt
   * @param {Array} messages - [{role: 'user', content: '...'}]
   * @param {string} stepName - 'analysis' or 'rewrite'
   * @returns {Promise<string>} raw text response
   */
  async invoke(systemPrompt, messages, stepName) {
    throw new Error(`${this.name}: invoke() not implemented`);
  }

  /**
   * Override in subclass: return display label for current model
   */
  getModelLabel() {
    return this.name;
  }

  /**
   * Override in subclass: return the model ID used for logging
   */
  getModelId() {
    return this.name;
  }

  // ── JSON Parsing ──

  parseJSON(response, step = "") {
    let text = response.trim();

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

  // ── Response Expansion ──

  expandAnalysisResponse(abbreviated) {
    return {
      exactMatch: abbreviated.exact || [],
      coreSkills: abbreviated.coreSkills || [],
      canClaim: abbreviated.claim || [],
      cannotClaim: abbreviated.no || [],
      keyPhrases: abbreviated.phrases || [],
      missing: abbreviated.miss || [],
      jdLang: abbreviated.jdLang || null,
      jdYears: abbreviated.jdYears || null,
      jdTitle: abbreviated.jdTitle || null,
      jdCompany: abbreviated.jdCompany || null,
      requiredSkills: abbreviated.requiredSkills || [],
      niceToHave: abbreviated.niceToHave || [],
      jobType: abbreviated.jobType || "Full-time",
      salary: abbreviated.salary || null,
      contact: abbreviated.contact || {
        name: null,
        email: null,
        phone: null,
        link: null,
        applyUrl: null,
        instructions: null,
      },
      candidateTech: abbreviated.candidateTech || "Full Stack",
      relevantProjects: abbreviated.relevantProjects || [],
      personalProjects: abbreviated.personalProjects || [],
    };
  }

  expandRewriteResponse(abbreviated, resumeData) {
    const personalProjects = {};
    const projectDescriptions = {};

    (resumeData.projects || []).forEach((project) => {
      const key = project.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      personalProjects[project.name] = abbreviated[key] || "";
      projectDescriptions[key] = abbreviated[key] || "";
    });

    const projectsUsed = abbreviated.projectsUsed || [];

    return {
      title: abbreviated.title || "Software Developer",
      summary: abbreviated.sum || "",
      bullets: abbreviated.bul || [],
      skills: abbreviated.skl || "",
      projects: personalProjects,
      projectsUsed,
      ...projectDescriptions,
    };
  }

  // ── Main Pipeline ──

  /**
   * Full tailoring pipeline: analyze JD → rewrite resume → score
   * @param {string} jobDescription
   * @param {Object} resumeData
   * @param {string} [modelOverride] - provider-specific model override
   * @returns {Object} tailored resume with ATS score
   */
  async tailorResume(jobDescription, resumeData, modelOverride) {
    const systemPrompt = prompts.buildSystemPrompt(resumeData);
    const resumeContext = prompts.buildResumeContext(resumeData);

    // ── Step 1: Analysis ──
    console.log(`\n🔍 STEP 1: Analyzing JD keywords... [${this.getModelLabel()}]`);

    const analysisUserPrompt = `${resumeContext}\n\n${prompts.buildAnalysisPrompt(jobDescription, resumeData)}`;
    const analysisMessages = [{ role: "user", content: analysisUserPrompt }];

    const analysisText = await this.invoke(
      systemPrompt,
      analysisMessages,
      "analysis",
    );
    const analysisRaw = this.parseJSON(analysisText, "Step 1 - Analysis");
    const analysis = this.expandAnalysisResponse(analysisRaw);
    displayAnalysis(analysis);

    const jobTitle = jobDescription.split("\n")[0];
    logKeywordGaps(jobTitle, analysis);
    logContactDetails(analysis.contact, {
      title: analysis.jdTitle,
      company: analysis.jdCompany,
    });

    // ── Step 2: Rewrite ──
    console.log(`\n✍️  STEP 2: Rewriting resume... [${this.getModelLabel()}]`);

    const resumeContextForRewrite = prompts.buildResumeContextForRewrite(
      resumeData,
      analysis,
    );
    const rewriteUserPrompt = prompts.buildRewritePrompt(
      jobDescription,
      analysisRaw,
      resumeData,
      resumeContextForRewrite,
    );
    const rewriteMessages = [{ role: "user", content: rewriteUserPrompt }];

    const rewriteText = await this.invoke(
      systemPrompt,
      rewriteMessages,
      "rewrite",
    );
    const rewriteRaw = this.parseJSON(rewriteText, "Step 2 - Rewrite");
    const rewritten = this.expandRewriteResponse(rewriteRaw, resumeData);

    // ── Step 3: Score (Deterministic) ──
    const score = scoreResume(analysis, rewritten, resumeData);

    if (
      !rewritten.summary ||
      !Array.isArray(rewritten.bullets) ||
      rewritten.bullets.length < 4
    ) {
      throw new Error("Invalid rewrite output");
    }

    logResumeHistory(analysis, rewritten, score, this.getModelId());
    displayCostSummary();
    displayScore(score);

    return {
      ...rewritten,
      jdTitle: analysis.jdTitle || null,
      jdCompany: analysis.jdCompany || null,
      jobType: analysis.jobType || "Full-time",
      salary: analysis.salary || null,
      contact: analysis.contact,
      atsScore: score,
    };
  }
}

export default BaseProvider;
