/**
 * Resume Forge Web Server
 *
 * Wraps the existing CLI pipeline into a web API with SSE progress streaming.
 * No changes to existing services - just a web layer on top.
 */

import express from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import config from './config.js';
import { validateJobDescription } from './services/clipboard.js';
import { generateDocx } from './services/document.js';
import { convertToPdf, cleanupDocx, checkLibreOffice } from './services/converter.js';
import { generateEmail, generateLinkedInDM } from './services/email-generator.js';
import { saveLinkedInDM, saveEmailData, getAllEmailContacts, updateEmailStatus, getUnsentEmails, markEmailAsSent, saveResumeForContact } from './services/contact-logger.js';
import { sendEmail, verifyConnection } from './services/email-sender.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public'), { index: 'index.html' }));

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Dynamic AI service loader
async function getAIService() {
  const provider = config.ai.provider;
  if (provider === 'bedrock') {
    const module = await import('./services/ai-bedrock.js');
    return module.tailorResume;
  }
  const module = await import('./services/ai.js');
  return module.tailorResume;
}

// Load resume data
function loadResumeData() {
  if (!fs.existsSync(config.paths.resumeData)) {
    throw new Error(`Resume data not found: ${config.paths.resumeData}`);
  }
  return JSON.parse(fs.readFileSync(config.paths.resumeData, 'utf-8'));
}

// Pre-flight checks
function preflightChecks() {
  const hasLibreOffice = checkLibreOffice();
  const provider = config.ai.provider;

  const errors = [];
  if (provider === 'bedrock') {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      errors.push('AWS credentials not configured');
    }
  } else {
    if (!config.ai.geminiApiKey) errors.push('Gemini API key not configured');
  }
  if (!fs.existsSync(config.paths.resumeData)) errors.push('resumeData.json not found');
  if (!fs.existsSync(config.paths.template)) errors.push('template.docx not found');

  return { hasLibreOffice, errors, provider };
}

// SSE helper
function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Main generate endpoint - SSE stream
app.post('/api/generate', async (req, res) => {
  const { jobDescription, model } = req.body;

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    // Step 0: Preflight
    sendEvent(res, 'step', { step: 0, label: 'Running pre-flight checks...' });
    const { hasLibreOffice, errors, provider } = preflightChecks();
    if (errors.length > 0) {
      sendEvent(res, 'error', { message: `Pre-flight failed: ${errors.join(', ')}` });
      return res.end();
    }
    sendEvent(res, 'step', { step: 0, label: 'Pre-flight checks passed', done: true });

    // Step 1: Validate JD
    sendEvent(res, 'step', { step: 1, label: 'Validating job description...' });
    try {
      validateJobDescription(jobDescription);
    } catch (e) {
      sendEvent(res, 'error', { message: e.message });
      return res.end();
    }
    sendEvent(res, 'step', { step: 1, label: 'Job description validated', done: true });

    // Step 2: Load resume data
    sendEvent(res, 'step', { step: 2, label: 'Loading resume data...' });
    const resumeData = loadResumeData();
    sendEvent(res, 'step', { step: 2, label: `Loaded: ${resumeData.personalInfo?.name}`, done: true });

    // Step 3: AI Tailoring
    const modelLabel = model || config.ai.bedrock.modelId || 'haiku';
    sendEvent(res, 'step', { step: 3, label: `AI tailoring via ${provider.toUpperCase()} [${modelLabel}]...` });
    const tailorResume = await getAIService();
    const aiResponse = await tailorResume(jobDescription, resumeData, model);
    sendEvent(res, 'step', { step: 3, label: 'AI tailoring complete', done: true });

    // Step 4: Generate outputs (email, LinkedIn)
    sendEvent(res, 'step', { step: 4, label: 'Generating email & LinkedIn DM...' });
    const emailData = generateEmail(aiResponse, resumeData);
    const linkedInDM = generateLinkedInDM(aiResponse, resumeData);

    if (emailData) {
      saveEmailData(emailData.to, emailData.subject, emailData.body);
    }
    saveLinkedInDM(linkedInDM.linkedInUrl, linkedInDM.message, linkedInDM.contactName);
    sendEvent(res, 'step', { step: 4, label: 'Messages generated', done: true });

    // Step 5: Generate DOCX
    sendEvent(res, 'step', { step: 5, label: 'Generating resume document...' });
    const userName = resumeData.personalInfo?.name || 'Resume';
    const jobRole = 'MERN-Developer';
    const outputPaths = config.paths.getOutputPaths(userName, jobRole);
    const docxPath = await generateDocx(aiResponse, outputPaths, resumeData);
    sendEvent(res, 'step', { step: 5, label: 'DOCX generated', done: true });

    // Step 6: Convert to PDF
    let outputPath = docxPath;
    if (hasLibreOffice) {
      sendEvent(res, 'step', { step: 6, label: 'Converting to PDF...' });
      outputPath = await convertToPdf(docxPath, outputPaths.pdf);
      cleanupDocx(docxPath);
      sendEvent(res, 'step', { step: 6, label: 'PDF ready', done: true });
    } else {
      sendEvent(res, 'step', { step: 6, label: 'PDF skipped (no LibreOffice)', done: true });
    }

    // Save per-job resume copy
    saveResumeForContact(outputPath, aiResponse.jdTitle, aiResponse.jdCompany);

    // Build personal projects data
    const personalProjects = (resumeData.projects || []).map(project => {
      const key = project.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      return { name: project.name, description: aiResponse[key] || '' };
    });

    // Read cost logs
    let costData = null;
    const costFile = join(__dirname, 'logs', 'bedrock_costs.json');
    if (fs.existsSync(costFile)) {
      try { costData = JSON.parse(fs.readFileSync(costFile, 'utf-8')); } catch {}
    }

    // Send final result
    sendEvent(res, 'result', {
      title: aiResponse.title,
      summary: aiResponse.summary,
      skills: aiResponse.skills,
      bullets: aiResponse.bullets,
      personalProjects,
      atsScore: aiResponse.atsScore || null,
      jobType: aiResponse.jobType || 'Full-time',
      salary: aiResponse.salary || null,
      email: emailData,
      linkedInDM,
      contact: aiResponse.contact || null,
      outputPath,
      costData,
    });

  } catch (error) {
    sendEvent(res, 'error', { message: error.message });
  }

  res.end();
});

// Health check
app.get('/api/health', (req, res) => {
  const { errors, provider } = preflightChecks();
  res.json({ ok: errors.length === 0, provider, errors });
});

// Available AI models
app.get('/api/models', (req, res) => {
  const aliases = config.ai.bedrock.modelAliases || {};
  const raw = config.ai.bedrock.modelId || 'haiku';
  // Resolve: if raw is a full model ID, find its alias name
  const defaultModel = aliases[raw]
    ? raw
    : Object.entries(aliases).find(([, id]) => id === raw)?.[0] || raw;
  res.json({
    models: Object.keys(aliases),
    default: defaultModel,
  });
});

// Log data endpoints
const LOGS_DIR = join(__dirname, 'logs');

function readLogFile(filename) {
  const filepath = join(LOGS_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  try { return JSON.parse(fs.readFileSync(filepath, 'utf-8')); } catch { return null; }
}

app.get('/api/contacts', (req, res) => {
  res.json(readLogFile('contacts.json') || []);
});

// Email dashboard endpoints
app.get('/api/emails', (req, res) => {
  res.json(getAllEmailContacts());
});

app.post('/api/emails/approve', (req, res) => {
  const { index } = req.body;
  if (typeof index !== 'number') return res.status(400).json({ error: 'index required' });
  const ok = updateEmailStatus(index, 'approved');
  res.json({ ok });
});

app.post('/api/emails/reject', (req, res) => {
  const { index } = req.body;
  if (typeof index !== 'number') return res.status(400).json({ error: 'index required' });
  const ok = updateEmailStatus(index, 'rejected');
  res.json({ ok });
});

app.post('/api/emails/reset', (req, res) => {
  const { index } = req.body;
  if (typeof index !== 'number') return res.status(400).json({ error: 'index required' });
  const ok = updateEmailStatus(index, 'drafted');
  res.json({ ok });
});

app.post('/api/emails/send', async (req, res) => {
  const unsent = getUnsentEmails();
  if (unsent.length === 0) return res.json({ sent: 0, failed: 0, message: 'No approved emails to send' });

  const connected = await verifyConnection();
  if (!connected) return res.status(500).json({ error: 'SMTP connection failed' });

  const results = { sent: 0, failed: 0, errors: [] };

  for (let i = 0; i < unsent.length; i++) {
    const contact = unsent[i];
    let emailData;
    if (contact.emailData?.subject && contact.emailData?.body) {
      emailData = { to: contact.to, subject: contact.emailData.subject, body: contact.emailData.body };
    } else {
      emailData = {
        to: contact.to,
        subject: `Application for ${contact.jobTitle || 'the open position'}${contact.jobCompany ? ` at ${contact.jobCompany}` : ''}`,
        body: `Dear ${contact.contactName || 'Hiring Manager'},\n\nI am writing to express my interest in the ${contact.jobTitle || 'open position'}${contact.jobCompany ? ` at ${contact.jobCompany}` : ''}. Please find my resume attached.\n\nBest regards`,
      };
    }

    if (contact.resumePath) emailData.resumePath = contact.resumePath;

    const result = await sendEmail(emailData, true);
    if (result.success) { results.sent++; } else { results.failed++; results.errors.push({ to: contact.to, error: result.error }); }

    if (i < unsent.length - 1) await new Promise(r => setTimeout(r, 1200));
  }

  res.json(results);
});

app.get('/api/costs', (req, res) => {
  res.json(readLogFile('bedrock_costs.json') || {});
});

app.get('/api/history', (req, res) => {
  res.json(readLogFile('resume_history.json') || []);
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  const provider = config.ai.provider;
  const bedrockModelId = config.ai.bedrock.modelId || 'haiku';
  const resolved = config.ai.bedrock.modelAliases?.[bedrockModelId] || bedrockModelId;
  const modelLabel = provider === 'bedrock'
    ? `Bedrock → ${resolved}`
    : 'Gemini';

  console.log(`\n  🚀 Resume Forge Web UI`);
  console.log(`  ➜ http://localhost:${PORT}`);
  console.log(`  ⚙ AI Model: ${modelLabel}\n`);
});
