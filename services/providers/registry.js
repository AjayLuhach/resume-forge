/**
 * Provider Registry
 *
 * Factory for creating AI provider instances.
 * Handles dynamic loading and validation of providers.
 *
 * Adding a new provider:
 * 1. Create a new file in services/providers/ extending BaseProvider
 * 2. Register it in the PROVIDERS map below
 * 3. Add its config block to config.js
 */

import config from "../../config.js";

// Provider registry - maps name to module path + class
const PROVIDERS = {
  bedrock: {
    module: "./bedrock.js",
    className: "BedrockProvider",
    label: "AWS Bedrock",
  },
  gemini: {
    module: "./gemini.js",
    className: "GeminiProvider",
    label: "Google Gemini",
  },
};

/**
 * Create a provider instance
 * @param {string} [providerName] - Provider name (default: from config)
 * @param {string} [modelOverride] - Model override for the provider
 * @returns {Promise<BaseProvider>} Provider instance with tailorResume method
 */
export async function getProvider(providerName, modelOverride) {
  const name = providerName || config.ai.provider || "bedrock";

  const entry = PROVIDERS[name];
  if (!entry) {
    const available = Object.keys(PROVIDERS).join(", ");
    throw new Error(
      `Unknown AI provider: "${name}". Available: ${available}`,
    );
  }

  const module = await import(entry.module);
  const ProviderClass = module[entry.className] || module.default;

  return new ProviderClass(modelOverride);
}

/**
 * Get list of available providers with their configuration status
 */
export async function listProviders() {
  const result = {};

  for (const [name, entry] of Object.entries(PROVIDERS)) {
    try {
      const module = await import(entry.module);
      const ProviderClass = module[entry.className] || module.default;

      result[name] = {
        label: entry.label,
        configured: ProviderClass.isConfigured?.() ?? false,
        models: ProviderClass.getModels?.() ?? { models: [], default: null },
      };
    } catch (error) {
      result[name] = {
        label: entry.label,
        configured: false,
        models: { models: [], default: null },
        error: error.message,
      };
    }
  }

  return result;
}

/**
 * Get the names of all registered providers
 */
export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

export default { getProvider, listProviders, getProviderNames };
