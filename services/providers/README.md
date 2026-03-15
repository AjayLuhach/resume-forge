# Adding a New AI Provider

To add a new AI provider (e.g., OpenAI, Ollama, Anthropic direct):

## 1. Create the provider file

Create `services/providers/your-provider.js`:

```js
import { BaseProvider } from "./base-provider.js";
import { logApiCall } from "../cost-logger.js";

export class YourProvider extends BaseProvider {
  constructor(modelOverride) {
    super("your-provider");
    // Set up your client, model config, etc.
  }

  getModelLabel() {
    return "your-model-name";
  }

  getModelId() {
    return "your-model-id";
  }

  async invoke(systemPrompt, messages, stepName) {
    // Call your AI API here
    // messages = [{ role: 'user', content: '...' }]
    // Return raw text response
    //
    // Log usage for cost tracking:
    // logApiCall(stepName, { input_tokens: X, output_tokens: Y }, modelId);
  }

  static isConfigured() {
    return !!process.env.YOUR_API_KEY;
  }

  static getModels() {
    return { models: ["model-1", "model-2"], default: "model-1" };
  }
}
```

## 2. Register it

Add to the `PROVIDERS` map in `services/providers/registry.js`:

```js
const PROVIDERS = {
  // ... existing providers
  "your-provider": {
    module: "./your-provider.js",
    className: "YourProvider",
    label: "Your Provider Name",
  },
};
```

## 3. Add config (optional)

Add a config block in `config.js` under `ai`:

```js
ai: {
  // ...existing
  "your-provider": {
    apiKey: process.env.YOUR_API_KEY || '',
    model: process.env.YOUR_MODEL || 'default-model',
  },
}
```

## 4. Use it

```bash
AI_PROVIDER=your-provider node index.js
# or via web UI provider selector
```

That's it. The base class handles all prompts, scoring, logging, and display.
You only need to implement `invoke()` — the API call itself.
