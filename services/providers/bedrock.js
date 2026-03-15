/**
 * AWS Bedrock AI Provider
 *
 * Uses the Bedrock Converse API (model-agnostic).
 * Supports: Claude, DeepSeek, Qwen, GLM, and any future Bedrock model.
 *
 * Required env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 * Optional: AWS_REGION (default: us-east-1), BEDROCK_MODEL (default: haiku)
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { logApiCall } from "../cost-logger.js";
import config from "../../config.js";
import { BaseProvider } from "./base-provider.js";

export class BedrockProvider extends BaseProvider {
  constructor(modelOverride) {
    super("bedrock");

    const bedrockConfig = config.ai.bedrock;
    const aliases = bedrockConfig.modelAliases || {};
    const rawModelId = modelOverride || bedrockConfig.modelId || "haiku";

    this.modelId = aliases[rawModelId] || rawModelId;
    this.modelLabel = aliases[rawModelId]
      ? rawModelId
      : this.modelId.split(".").pop();
    this.region = bedrockConfig.region || process.env.AWS_REGION || "us-east-1";
    this.maxTokens = bedrockConfig.maxTokens || {
      analysis: 3072,
      rewrite: 2048,
    };
    this.client = null;
  }

  getClient() {
    if (!this.client) {
      this.client = new BedrockRuntimeClient({ region: this.region });
    }
    return this.client;
  }

  getModelLabel() {
    return this.modelLabel;
  }

  getModelId() {
    return this.modelId;
  }

  async invoke(systemPrompt, messages, stepName) {
    const client = this.getClient();
    const maxTokens = this.maxTokens[stepName] || 2048;

    const converseMessages = messages.map((msg) => ({
      role: msg.role,
      content: [{ text: typeof msg.content === "string" ? msg.content : msg.content }],
    }));

    const command = new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: systemPrompt }],
      messages: converseMessages,
      inferenceConfig: {
        maxTokens,
        temperature: 0.1,
      },
    });

    try {
      const response = await client.send(command);

      if (response.usage) {
        logApiCall(
          stepName,
          {
            input_tokens: response.usage.inputTokens,
            output_tokens: response.usage.outputTokens,
          },
          this.modelId,
        );
      }

      const outputContent = response.output?.message?.content;
      if (outputContent && outputContent.length > 0) {
        return outputContent[0].text;
      }

      throw new Error("Empty response from Bedrock Converse API");
    } catch (error) {
      console.error(`Bedrock API error (${stepName}):`, error.message);
      throw error;
    }
  }

  /**
   * Check if Bedrock credentials are configured
   */
  static isConfigured() {
    return !!(
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    );
  }

  /**
   * Get available model aliases
   */
  static getModels() {
    const aliases = config.ai.bedrock.modelAliases || {};
    const raw = config.ai.bedrock.modelId || "haiku";
    const defaultModel = aliases[raw]
      ? raw
      : Object.entries(aliases).find(([, id]) => id === raw)?.[0] || raw;
    return {
      models: Object.keys(aliases),
      default: defaultModel,
    };
  }
}

export default BedrockProvider;
