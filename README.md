# Resume Forge

AI-powered CLI and web tool that automatically tailors your resume for each job application. Paste a job description, get an ATS-optimized resume PDF with tailored content, email drafts, and LinkedIn DMs — in seconds.

## How It Works

1. You maintain a single `resumeData.json` — your master resume with all experience, skills, and projects
2. Paste a job description (clipboard or web UI)
3. AI analyzes the JD, extracts keywords, and cross-references against your resume
4. Your resume content is rewritten to match the JD while staying truthful (only claims skills you actually have)
5. A deterministic ATS scorer grades the output
6. A tailored PDF is generated, overwriting the same output file each time for easy access

The output file is always saved to the same path (`OUTPUT_DIR/YourName_Role.pdf`), so you can bookmark it or set it as your default resume attachment — it always contains the latest tailored version.

## Quick Start

```bash
# Clone and install
git clone https://github.com/AjayLuhach/resume-forge.git
cd resume-forge
npm install

# Configure
cp .env.example .env
# Edit .env with your AI provider keys (see below)

# Edit resumeData.json with your own resume data

# Generate the DOCX template from resumeData.json
npm run setup

# Option A: CLI (copies JD from clipboard)
npm start

# Option B: Web UI
Instead of reading README, you can explore about project directly in the web application.
npm run web

# Open
http://localhost:5003/about.html
```

## Configuration

All user-configurable settings live in `.env`. Copy `.env.example` to get started.

### AI Provider (required — pick one)

**Google Gemini** (free tier):
```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```
Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Free tier has rate limits — the tool auto-rotates through model variants when one is rate-limited.

**AWS Bedrock** (paid, multi-model):
```env
AI_PROVIDER=bedrock
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
BEDROCK_MODEL=haiku
```
Supports model aliases: `haiku` (Claude), `deepseek`, `qwen`, `glm` — or any full Bedrock model ID.

### Output Directory

```env
OUTPUT_DIR=~/Music
```

The generated resume PDF is saved here with a fixed filename (`YourName_Role.pdf`). Each run overwrites the same file, so you can keep this path as your default resume attachment in email clients, job portals, etc. Supports absolute paths, `~/` expansion, or relative paths from the project root. Defaults to `./output` if not set.

### Email Sending (optional)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
FROM_NAME=Your Name
RESUME_PATH=./Your_Resume.pdf
```

For Gmail: enable 2FA, then generate an App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).

## Web UI Pages

Start the server with `npm run web` and open `http://localhost:5003`.

### Generate (`/`)
Paste a JD, pick your AI provider and model from the dropdowns, and generate. Shows real-time progress via SSE streaming, then displays the tailored resume content, ATS score, email draft, and LinkedIn DM.

### Emails (`/emails.html`)
Dashboard for managing outreach emails. When a JD contains recruiter contact info, the tool auto-drafts a personalized email. Review, approve, or reject emails here before sending. Approved emails can be sent in bulk via the UI or CLI (`npm run send:emails`).

### Contacts (`/contacts.html`)
Log of all contacts extracted from job descriptions — recruiter names, emails, LinkedIn URLs, application form links. Auto-populated each time you generate a tailored resume.

### History (`/history.html`)
Full history of every resume you've generated — job title, company, date, ATS score, and the exact content used. Click any entry to download that version's PDF. If the PDF file doesn't exist locally (e.g., after a fresh clone), it's regenerated on-the-fly from the saved history data.

### Costs (`/costs.html`)
Tracks API usage and costs across all providers — total calls, input/output tokens, cost per step (analysis vs rewrite), and recent call log with per-model breakdown.

### Skill Gaps (`/gaps.html`)
Aggregated view of skills that kept appearing in job descriptions but aren't on your resume — built from your application history. Shows:
- **Learning suggestions** — top missing skills ranked by how often they appear across all JDs you've applied to, with priority levels (high/medium/low)
- **Missing skills chart** — critical JD requirements you don't have, sorted by frequency
- **Out-of-scope skills chart** — skills you have alternatives for (e.g., you have MongoDB but JD wants Cassandra), sorted by frequency
- **Recent timeline** — last 30 applications with their gap breakdown per JD

## PDF Conversion

The tool generates a `.docx` from your template, then converts it to PDF. Two backends are supported:

**LibreOffice** (recommended) — produces pixel-perfect PDFs that preserve all colors, fonts, and formatting from your DOCX template. If LibreOffice isn't installed, the tool will attempt to auto-install `libreoffice-writer` (the minimal ~150MB package, not the full suite):
- Linux (apt): `sudo apt install libreoffice-writer`
- Linux (dnf): `sudo dnf install libreoffice-writer`
- macOS: `brew install --cask libreoffice`

Or install manually: `npm run install-pdf`

**Puppeteer/Chrome** (fallback) — uses your system Chrome to convert DOCX→HTML→PDF. Works without any extra install if you have Chrome, but the intermediate HTML conversion may lose some colors and formatting. This is the automatic fallback if LibreOffice isn't available and can't be auto-installed.

If neither is available, the tool outputs a `.docx` file instead.

## Project Structure

```
resume-forge/
  index.js                    # CLI entry point
  server.js                   # Web server (Express + SSE)
  config.js                   # All configuration (reads from .env)
  resumeData.json             # Your master resume data
  template.docx               # DOCX template (generated via npm run setup)
  public/                     # Web UI pages
  scripts/
    send-emails.js            # CLI email sender
    backfill-resumes.js       # Regenerate PDFs for old contacts
    claude-code-generate.js   # Pipeline runner for Claude Code workflow
    generate-template.js      # Generates template.docx from resumeData
  services/
    providers/                # AI provider implementations
      base-provider.js        #   Pipeline orchestration + JSON parsing
      bedrock.js              #   AWS Bedrock (Converse API)
      gemini.js               #   Google Gemini (with model pool rotation)
      registry.js             #   Provider factory + discovery
    pipeline/                 # Core resume processing
      prompts.js              #   All AI prompt templates
      ats-scorer.js           #   Deterministic ATS scoring
      document.js             #   DOCX generation from template
      converter.js            #   PDF conversion (LibreOffice / Puppeteer)
    outreach/                 # Communication
      email-generator.js      #   Email + LinkedIn DM template generation
      email-sender.js         #   SMTP email sending
      contact-logger.js       #   Contact and email data persistence
    clipboard.js              # Clipboard reading + JD validation
    cost-logger.js            # API usage + cost tracking
    display.js                # Console output formatting
    logging.js                # Resume history + keyword gap logging
```

## Contributing

### Adding a New AI Provider

This is the most common contribution. The provider system is pluggable — you only need to implement one method (`invoke`) that calls your AI API:

1. Create `services/providers/your-provider.js` extending `BaseProvider`
2. Register it in `services/providers/registry.js`
3. Add env vars to `.env.example`

See [services/providers/README.md](services/providers/README.md) for a full step-by-step guide with code examples. The base class handles all prompts, scoring, logging, and display — you only write the API call.

### Guidelines

- Keep changes focused — one feature or fix per PR
- Don't modify `resumeData.json` (that's user data)
- Prompts live in `services/pipeline/prompts.js` — edit them there, not in provider code
- ATS scoring is intentionally deterministic (no AI) — it's rule-based keyword matching in `ats-scorer.js`
- The web UI is plain HTML/CSS/JS in `public/` — no build step, no framework
- Test with both CLI (`npm start`) and web UI (`npm run web`) when making pipeline changes

### Development

```bash
# Run web server
npm run web

# Run CLI (copy a JD to clipboard first)
npm start

# Test SMTP connection
npm run verify-smtp

# Send approved emails
npm run send:emails

# Regenerate PDFs for contacts missing resume files
npm run backfill:resumes
```

## License

MIT
