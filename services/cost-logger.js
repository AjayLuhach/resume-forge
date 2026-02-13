/**
 * Bedrock Cost Logger Service
 *
 * Tracks API usage and calculates costs for Bedrock models.
 *
 * Supported models (AWS Bedrock pricing):
 * - Claude Haiku 4.5: Input $1.00/1M, Output $5.00/1M
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cost file paths
const COST_FILE = path.join(__dirname, '..', 'logs', 'bedrock_costs.json');
const HISTORY_FILE = path.join(__dirname, '..', 'logs', 'bedrock_history.json');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Settings
const MAX_RECENT_CALLS = 100;

// USD to INR conversion rate
const USD_TO_INR = 83.5;

// Model pricing (per 1M tokens) in USD
const MODEL_PRICING_USD = {
  // Claude Haiku 4.5 - AWS Bedrock pricing
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': {
    input: 1.00,
    output: 5.00,
  },
  // Default fallback
  default: {
    input: 1.00,
    output: 5.00,
  },
};

/**
 * Get pricing for a specific model
 */
function getModelPricing(modelId) {
  const pricingUSD = MODEL_PRICING_USD[modelId] || MODEL_PRICING_USD.default;
  return {
    input: pricingUSD.input * USD_TO_INR,
    output: pricingUSD.output * USD_TO_INR,
  };
}

/**
 * Append call to history file for visualization
 * This file grows over time and can be used for charts
 *
 * Structure optimized for visualization:
 * - calls: array of all calls with running totals
 * - byStep: separate arrays per step type for line graphs
 */
function appendToHistory(callEntry, runningTotal) {
  let history = {
    createdAt: new Date().toISOString(),
    calls: [],
    byStep: {
      analysis: [],
      rewrite: [],
      scoring: [],
    },
  };

  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
      // Ensure byStep exists for older files
      if (!history.byStep) {
        history.byStep = { analysis: [], rewrite: [], scoring: [] };
      }
    } catch (e) {
      // Keep default
    }
  }

  const callNumber = history.calls.length + 1;

  // Add entry with running total for easy graphing
  const historyEntry = {
    ...callEntry,
    runningTotalINR: Math.round(runningTotal * 10000) / 10000,
    callNumber,
  };

  history.calls.push(historyEntry);

  // Also add to step-specific array for per-step visualization
  if (history.byStep[callEntry.step]) {
    const stepCalls = history.byStep[callEntry.step];
    const stepRunningTotal = stepCalls.length > 0
      ? stepCalls[stepCalls.length - 1].stepTotalINR + callEntry.cost
      : callEntry.cost;

    history.byStep[callEntry.step].push({
      timestamp: callEntry.timestamp,
      cost: callEntry.cost,
      inputTokens: callEntry.inputTokens,
      outputTokens: callEntry.outputTokens,
      stepCallNumber: stepCalls.length + 1,
      stepTotalINR: Math.round(stepRunningTotal * 10000) / 10000,
      globalCallNumber: callNumber,
    });
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Initialize or load existing cost data
 */
function loadCostData() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  if (fs.existsSync(COST_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(COST_FILE, 'utf-8'));
    } catch (e) {
      // Corrupted file, start fresh
    }
  }

  // Default structure
  return {
    sessionStart: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    summary: {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
    },
    byStep: {
      analysis: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      rewrite: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      scoring: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    },
    recentCalls: [],
  };
}

/**
 * Calculate cost from token counts
 */
function calculateCost(usage, modelId = 'default') {
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;

  const pricing = getModelPricing(modelId);

  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return {
    inputTokens,
    outputTokens,
    cost: Math.round(cost * 1_000_000) / 1_000_000,
    modelId,
  };
}

/**
 * Log an API call with its usage data
 *
 * @param {string} step - 'analysis', 'rewrite', or 'scoring'
 * @param {object} usage - Usage object from Bedrock response
 * @param {string} modelId - Model ID used for the call
 */
export function logApiCall(step, usage, modelId = 'default') {
  if (!usage) return;

  const data = loadCostData();
  const costs = calculateCost(usage, modelId);

  // Update summary
  data.summary.totalCalls++;
  data.summary.totalInputTokens += costs.inputTokens;
  data.summary.totalOutputTokens += costs.outputTokens;
  data.summary.totalCost += costs.cost;

  // Update step-specific stats
  if (data.byStep[step]) {
    data.byStep[step].calls++;
    data.byStep[step].inputTokens += costs.inputTokens;
    data.byStep[step].outputTokens += costs.outputTokens;
    data.byStep[step].cost += costs.cost;
  }

  // Add to recent calls (keep last MAX_RECENT_CALLS)
  const callEntry = {
    timestamp: new Date().toISOString(),
    step,
    modelId: modelId,
    ...costs,
  };
  data.recentCalls.unshift(callEntry);
  if (data.recentCalls.length > MAX_RECENT_CALLS) {
    data.recentCalls = data.recentCalls.slice(0, MAX_RECENT_CALLS);
  }

  // Append to history file for visualization
  appendToHistory(callEntry, data.summary.totalCost);

  // Update timestamp
  data.lastUpdated = new Date().toISOString();

  // Round total cost
  data.summary.totalCost = Math.round(data.summary.totalCost * 1_000_000) / 1_000_000;

  // Write to file
  fs.writeFileSync(COST_FILE, JSON.stringify(data, null, 2));

  return costs;
}

/**
 * Get current cost summary (for display)
 */
export function getCostSummary() {
  const data = loadCostData();
  return data.summary;
}

/**
 * Display cost summary in console
 */
export function displayCostSummary() {
  const data = loadCostData();
  const s = data.summary;

  console.log('\n' + '─'.repeat(60));
  console.log('💰 BEDROCK COST SUMMARY (INR)');
  console.log('─'.repeat(60));

  console.log(`\n📊 Session: ${data.sessionStart.split('T')[0]}`);
  console.log(`   Total API Calls: ${s.totalCalls}`);

  console.log('\n📈 TOKEN USAGE:');
  console.log(`   Input:  ${s.totalInputTokens.toLocaleString()} tokens`);
  console.log(`   Output: ${s.totalOutputTokens.toLocaleString()} tokens`);

  console.log('\n💵 COST BY STEP:');
  for (const [step, stats] of Object.entries(data.byStep)) {
    if (stats.calls > 0) {
      // Get model name from recent calls
      const recentCall = data.recentCalls.find((c) => c.step === step);
      const modelName = recentCall?.modelId?.split('.')[1]?.split('-')[0] || 'unknown';
      console.log(`   ${step.padEnd(10)}: ${stats.calls} calls (${modelName}), ₹${stats.cost.toFixed(4)}`);
    }
  }

  console.log('\n💰 TOTAL COST: ₹' + s.totalCost.toFixed(4));
  const usdCost = s.totalCost / USD_TO_INR;
  console.log(`   (≈ $${usdCost.toFixed(6)} USD)`);

  console.log('\n' + '─'.repeat(60));
}

/**
 * Reset cost tracking (start new session)
 */
export function resetCostTracking() {
  const data = {
    sessionStart: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    summary: {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
    },
    byStep: {
      analysis: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      rewrite: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      scoring: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    },
    recentCalls: [],
  };

  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  fs.writeFileSync(COST_FILE, JSON.stringify(data, null, 2));
  console.log('💰 Cost tracking reset for new session');
}

/**
 * Get history data for visualization
 */
export function getHistory() {
  if (!fs.existsSync(HISTORY_FILE)) {
    return { calls: [], byStep: { analysis: [], rewrite: [], scoring: [] } };
  }
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch (e) {
    return { calls: [], byStep: { analysis: [], rewrite: [], scoring: [] } };
  }
}

/**
 * Clear history (for fresh start)
 */
export function clearHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    fs.unlinkSync(HISTORY_FILE);
  }
  console.log('📊 History cleared for fresh visualization');
}

export default {
  logApiCall,
  getCostSummary,
  displayCostSummary,
  resetCostTracking,
  getHistory,
  clearHistory,
};
