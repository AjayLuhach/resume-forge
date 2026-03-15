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
import { generateDocx } from './services/pipeline/document.js';
import { convertToPdf, cleanupDocx, checkLibreOffice } from './services/pipeline/converter.js';
import { generateEmail, generateLinkedInDM } from './services/outreach/email-generator.js';
import { saveLinkedInDM, saveEmailData, getAllEmailContacts, updateEmailStatus, getUnsentEmails, markEmailAsSent, saveResumeForContact } from './services/outreach/contact-logger.js';
import { sendEmail, verifyConnection } from './services/outreach/email-sender.js';
import { getProvider, listProviders } from './services/providers/registry.js';
import { validateResumeData } from './services/resume-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public'), { index: 'index.html' }));

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// AI service loader via provider registry

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
  } else if (provider === 'gemini') {
    if (!(config.ai.gemini.apiKey || process.env.GEMINI_API_KEY)) errors.push('Gemini API key not configured');
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
    const { hasLibreOffice, errors } = preflightChecks();
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
    const providerName = req.body.provider || config.ai.provider;
    const modelLabel = model || config.ai.bedrock.modelId || 'haiku';
    sendEvent(res, 'step', { step: 3, label: `AI tailoring via ${providerName.toUpperCase()} [${modelLabel}]...` });
    const aiProvider = await getProvider(providerName, model);
    const aiResponse = await aiProvider.tailorResume(jobDescription, resumeData);
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

// Resume data validation endpoint
app.get('/api/validate-resume', (req, res) => {
  try {
    if (!fs.existsSync(config.paths.resumeData)) {
      return res.json({
        valid: false,
        exists: false,
        errors: ['resumeData.json not found — copy resumeData.example.json and fill in your details'],
        warnings: [],
        summary: null,
      });
    }
    const data = JSON.parse(fs.readFileSync(config.paths.resumeData, 'utf-8'));
    const result = validateResumeData(data);
    res.json({ ...result, exists: true });
  } catch (err) {
    res.json({ valid: false, exists: true, errors: [`Failed to parse resumeData.json: ${err.message}`], warnings: [], summary: null });
  }
});

// Available AI providers and models
app.get('/api/models', async (req, res) => {
  const providers = await listProviders();
  const activeProvider = config.ai.provider;
  res.json({
    activeProvider,
    providers,
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

app.get('/api/keyword-gaps', (_req, res) => {
  res.json(readLogFile('keyword_gaps.json') || { entries: [], summary: {} });
});

app.get('/api/resumes', (req, res) => {
  const resumeDir = join(__dirname, 'logs', 'resumes');
  if (!fs.existsSync(resumeDir)) return res.json([]);
  const files = fs.readdirSync(resumeDir).filter(f => f.endsWith('.pdf'));
  res.json(files);
});

app.get('/api/resumes/:filename', async (req, res) => {
  const filename = req.params.filename;
  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const resumeDir = join(__dirname, 'logs', 'resumes');
  if (!fs.existsSync(resumeDir)) fs.mkdirSync(resumeDir, { recursive: true });

  const filePath = join(resumeDir, filename);

  // If PDF already exists, serve it directly
  if (fs.existsSync(filePath)) {
    return res.download(filePath);
  }

  // Otherwise, regenerate from history (same approach as backfill-resumes.js)
  const history = readLogFile('resume_history.json') || [];
  const sanitize = (s) => (s || 'Unknown').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-').substring(0, 40);

  // Find matching history entry by reconstructing filename
  const entry = history.find(h => {
    const date = h.date ? new Date(h.date).toISOString().split('T')[0] : '';
    const expected = `${date}_${sanitize(h.job?.company)}_${sanitize(h.job?.title)}.pdf`;
    return expected === filename;
  });

  if (!entry || !entry.resume) {
    return res.status(404).json({ error: 'Resume not found and no history data to regenerate' });
  }

  try {
    const resumeData = loadResumeData();

    // Reconstruct aiResponse from history (same as backfill script)
    const aiResponse = {
      title: entry.job?.title || 'Developer',
      summary: entry.resume.summary || '',
      bullets: entry.resume.bullets || [],
      skills: entry.resume.skills || '',
      projectsUsed: entry.resume.projectsUsed || [],
      jdTitle: entry.job?.title,
      jdCompany: entry.job?.company,
    };

    // Flatten project descriptions to key format
    if (entry.resume.projects && typeof entry.resume.projects === 'object') {
      for (const [projectName, description] of Object.entries(entry.resume.projects)) {
        const key = projectName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        aiResponse[key] = description;
      }
    }

    // Generate DOCX → PDF
    const tempBasename = `regen_${Date.now()}`;
    const tempDocx = join(resumeDir, `${tempBasename}.docx`);
    const outputPaths = { docx: tempDocx, pdf: filePath };

    await generateDocx(aiResponse, outputPaths, resumeData);

    if (checkLibreOffice()) {
      await convertToPdf(tempDocx, filePath);
      cleanupDocx(tempDocx);
    } else {
      // No LibreOffice — serve DOCX
      return res.download(tempDocx);
    }

    res.download(filePath);
  } catch (error) {
    console.error('Resume regeneration error:', error);
    res.status(500).json({ error: `Failed to generate resume: ${error.message}` });
  }
});

const PORT = process.env.PORT || 5003;
app.listen(PORT, () => {
  const activeProvider = config.ai.provider;

  console.log(`\n  Resume Forge Web UI`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  AI Provider: ${activeProvider}`);

  // Validate resume data on startup
  if (fs.existsSync(config.paths.resumeData)) {
    try {
      const data = JSON.parse(fs.readFileSync(config.paths.resumeData, 'utf-8'));
      const result = validateResumeData(data);
      if (result.valid) {
        console.log(`  Resume: ${result.summary.name} | ${result.summary.skillCount} skills | ${result.summary.workProjects} work projects`);
      } else {
        console.log(`  Resume: ${result.errors.length} error(s) found — check /api/validate-resume`);
      }
      if (result.warnings.length > 0) {
        console.log(`  Warnings: ${result.warnings.length}`);
      }
    } catch {
      console.log('  Resume: failed to parse resumeData.json');
    }
  } else {
    console.log('  Resume: resumeData.json not found — copy resumeData.example.json to get started');
  }
  console.log('');
});
