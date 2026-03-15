/**
 * Google Gemini AI Provider
 *
 * Uses the Google Generative AI SDK with model pool rotation
 * and automatic rate limit handling.
 *
 * Required env vars: GEMINI_API_KEY
 * Free tier with rate limits - rotates through model pool on 429 errors.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logApiCall } from "../cost-logger.js";
import config from "../../config.js";
import { BaseProvider } from "./base-provider.js";

export class GeminiProvider extends BaseProvider {
  constructor(modelOverride) {
    super("gemini");

    const geminiConfig = config.ai.gemini;
    this.apiKey = geminiConfig.apiKey || process.env.GEMINI_API_KEY || "";
    this.cooldown = geminiConfig.rateLimitCooldown || 60000;

    // Model pools per step (ordered by preference)
    this.modelPools = geminiConfig.models || {
      analysis: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
      rewrite: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    };

    // If a specific model override is provided, use only that model
    if (modelOverride) {
      this.modelPools = {
        analysis: [modelOverride],
        rewrite: [modelOverride],
      };
    }

    this.currentModel = null;
    this.client = null;
  }

  getClient() {
    if (!this.client) {
      if (!this.apiKey) {
        throw new Error("GEMINI_API_KEY not configured");
      }
      this.client = new GoogleGenerativeAI(this.apiKey);
    }
    return this.client;
  }

  getModelLabel() {
    return this.currentModel || "gemini";
  }

  getModelId() {
    return this.currentModel || "gemini";
  }

  async invoke(systemPrompt, messages, stepName) {
    const client = this.getClient();
    const pool = this.modelPools[stepName] || this.modelPools.analysis;

    let lastError = null;

    for (const modelName of pool) {
      try {
        this.currentModel = modelName;
        const model = client.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: stepName === "analysis" ? 3072 : 2048,
          },
        });

        // Build content from messages
        const userMessage = messages
          .map((m) => m.content)
          .join("\n\n");

        const result = await model.generateContent(userMessage);
        const response = result.response;
        const text = response.text();

        // Log usage if available
        const usage = response.usageMetadata;
        if (usage) {
          logApiCall(
            stepName,
            {
              input_tokens: usage.promptTokenCount || 0,
              output_tokens: usage.candidatesTokenCount || 0,
            },
            modelName,
          );
        }

        return text;
      } catch (error) {
        lastError = error;
        const isRateLimit =
          error.status === 429 ||
          error.message?.includes("429") ||
          error.message?.includes("Resource has been exhausted");

        if (isRateLimit) {
          console.warn(
            `\u26a0\ufe0f  ${modelName} rate limited, trying next model...`,
          );
          continue;
        }

        // Non-rate-limit error - don't retry with other models
        console.error(`Gemini API error (${stepName}):`, error.message);
        throw error;
      }
    }

    // All models exhausted
    throw new Error(
      `All Gemini models rate limited for ${stepName}. ` +
        `Wait ${this.cooldown / 1000}s or switch to a different provider. ` +
        `Last error: ${lastError?.message}`,
    );
  }

  /**
   * Check if Gemini is configured
   */
  static isConfigured() {
    return !!(config.ai.gemini.apiKey || process.env.GEMINI_API_KEY);
  }

  /**
   * Get available models
   */
  static getModels() {
    const models = config.ai.gemini.models?.analysis || [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ];
    // Deduplicate across step pools
    const allModels = [
      ...new Set([
        ...(config.ai.gemini.models?.analysis || []),
        ...(config.ai.gemini.models?.rewrite || []),
      ]),
    ];
    return {
      models: allModels,
      default: models[0],
    };
  }
}

export default GeminiProvider;
