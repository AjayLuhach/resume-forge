/**
 * Configuration for resume-forge CLI
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Output directory for resumes
const outputDir = join(homedir(), 'Music');

/**
 * Build output filename from user name and job role
 * e.g. "Ajay Kumar" + "MERN Developer" → "Ajay Kumar_MERN Developer"
 */
function buildOutputBasename(name, role) {
  // Sanitize for filesystem: remove characters not allowed in filenames
  const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '').trim();
  const safeName = sanitize(name || 'Resume');
  const safeRole = sanitize(role || 'Resume');
  return `${safeName}_${safeRole}`;
}

export const config = {
  // Paths
  paths: {
    resumeData: join(__dirname, 'resumeData.json'),
    template: join(__dirname, 'template.docx'),
    outputDir: outputDir,
    getOutputPaths: (name, role) => {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const basename = buildOutputBasename(name, role);
      return {
        docx: join(outputDir, `${basename}.docx`),
        pdf: join(outputDir, `${basename}.pdf`),
      };
    },
  },

  // AI Configuration
  ai: {
    // Provider: 'gemini' (free tier) or 'bedrock' (AWS, paid)
    provider: process.env.AI_PROVIDER || 'bedrock',

    // ─────────────────────────────────────────────────────────
    // GEMINI CONFIG (Google AI - Free tier with rate limits)
    // ─────────────────────────────────────────────────────────
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      // Model pool for rotation (ordered by preference)
      models: {
        analysis: [
          'gemini-2.5-pro',
          'gemini-3-pro-preview',
          'gemini-2.5-flash',
          'gemini-3-flash-preview',
          'gemini-2.0-flash',
          'gemini-2.0-flash-lite',
        ],
        rewrite: [
          'gemini-2.5-pro',
          'gemini-3-pro-preview',
          'gemini-2.5-flash',
          'gemini-3-flash-preview',
          'gemini-2.0-flash',
          'gemini-2.0-flash-lite',
        ],
        scoring: [
          'gemini-2.0-flash-lite',
          'gemini-2.5-flash-lite',
          'gemini-2.0-flash',
          'gemini-3-flash-preview',
          'gemini-2.5-flash',
          'gemini-2.5-pro',
        ],
      },
      rateLimitCooldown: 60000,
    },

    // ─────────────────────────────────────────────────────────
    // BEDROCK CONFIG (AWS - Paid, with prompt caching support)
    // ─────────────────────────────────────────────────────────
    bedrock: {
      region: process.env.AWS_REGION || 'us-east-1',

      // Set any Bedrock model ID directly, or use a shorthand alias
      // Aliases: 'haiku', 'deepseek', 'qwen', 'glm'
      // Or full model ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
      modelId: process.env.BEDROCK_MODEL || 'haiku',

      // Shorthand aliases → full Bedrock model IDs
      modelAliases: {
        haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        deepseek: 'deepseek.v3.2',
        qwen: 'qwen.qwen3-vl-235b-a22b',
        glm: 'zai.glm-4.7',
      },

      // Max tokens per step (applies to all models)
      maxTokens: {
        analysis: 3072,
        rewrite: 2048,
      },
    },

    // Legacy: keep for backward compatibility with ai.js
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    models: {
      analysis: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
      rewrite: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
      scoring: ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash'],
    },
    rateLimitCooldown: 60000,
  },

  // Output options
  output: {
    // Set to false to skip PDF conversion and keep DOCX only
    convertToPdf: true,
  },

  // LibreOffice path (only needed if convertToPdf is true)
  libreOffice: {
    command: 'libreoffice',
  },
};

export default config;
