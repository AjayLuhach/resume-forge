#!/usr/bin/env node

/**
 * Generate template.docx with placeholders
 *
 * Creates an ATS-friendly professional resume template with placeholders
 * that will be replaced by AI-generated tailored content.
 *
 * Placeholders:
 * - {{SUMMARY}} - Professional summary (tailored)
 * - {{SKILLS}} - Technical skills (tailored)
 * - {{B1}}-{{B6}} - Experience bullet points (tailored)
 *
 * Static content (not changed by AI):
 * - Personal info, education, projects remain fixed
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  convertInchesToTwip,
  TabStopPosition,
  TabStopType,
} from 'docx';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputPath = join(__dirname, '..', 'template.docx');

// Color scheme (ATS-friendly - minimal colors)
const colors = {
  primary: '1a1a1a',    // Dark text
  secondary: '4a4a4a',  // Gray text
  accent: '2563eb',     // Blue for links/name
};

// Font sizes (in half-points)
const fontSize = {
  name: 28,
  sectionTitle: 22,
  normal: 20,
  small: 18,
};

/**
 * Create section divider line
 */
function createDivider() {
  return new Paragraph({
    border: {
      bottom: {
        color: 'cccccc',
        space: 1,
        style: BorderStyle.SINGLE,
        size: 4,
      },
    },
    spacing: { after: 150 },
  });
}

/**
 * Create section header
 */
function createSectionHeader(title) {
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: title.toUpperCase(),
          bold: true,
          size: fontSize.sectionTitle,
          color: colors.primary,
        }),
      ],
      spacing: { before: 250, after: 80 },
    }),
    createDivider(),
  ];
}

/**
 * Create bullet point
 */
function createBullet(text, isPlaceholder = false) {
  return new Paragraph({
    children: [
      new TextRun({
        text: `• ${text}`,
        size: fontSize.normal,
        color: colors.primary,
      }),
    ],
    spacing: { before: 40, after: 40 },
    indent: { left: convertInchesToTwip(0.15) },
  });
}

/**
 * Create experience entry header
 */
function createExperienceHeader(title, company, duration, location) {
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: fontSize.normal,
          color: colors.primary,
        }),
        new TextRun({
          text: ` — ${company}`,
          size: fontSize.normal,
          color: colors.primary,
        }),
      ],
      spacing: { before: 150, after: 0 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${location} | ${duration}`,
          size: fontSize.small,
          color: colors.secondary,
          italics: true,
        }),
      ],
      spacing: { before: 0, after: 80 },
    }),
  ];
}

/**
 * Generate the template document
 */
async function generateTemplate() {
  console.log('📝 Generating ATS-friendly resume template...\n');

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.5),
              right: convertInchesToTwip(0.5),
              bottom: convertInchesToTwip(0.5),
              left: convertInchesToTwip(0.5),
            },
          },
        },
        children: [
          // ============ HEADER ============
          new Paragraph({
            children: [
              new TextRun({
                text: 'Ajay Kumar',
                bold: true,
                size: fontSize.name,
                color: colors.accent,
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
          }),

          // Contact Info (single line, ATS-friendly)
          new Paragraph({
            children: [
              new TextRun({
                text: 'Jind, Haryana, India | ajayluhach4@gmail.com | 9996033865',
                size: fontSize.small,
                color: colors.secondary,
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: 'github.com/AjayLuhach | linkedin.com/in/ajayluhach7 | ajayluhach.in',
                size: fontSize.small,
                color: colors.secondary,
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),

          // ============ PROFESSIONAL SUMMARY ============
          ...createSectionHeader('Professional Summary'),
          new Paragraph({
            children: [
              new TextRun({
                text: '{{SUMMARY}}',
                size: fontSize.normal,
                color: colors.primary,
              }),
            ],
            spacing: { after: 100 },
          }),

          // ============ TECHNICAL SKILLS ============
          ...createSectionHeader('Technical Skills'),
          new Paragraph({
            children: [
              new TextRun({
                text: '{{SKILLS}}',
                size: fontSize.normal,
                color: colors.primary,
              }),
            ],
            spacing: { after: 100 },
          }),

          // ============ EXPERIENCE ============
          ...createSectionHeader('Professional Experience'),

          // Current Job - Repozitory (with AI-tailored bullets)
          ...createExperienceHeader(
            'SDE (Full Stack Developer)',
            'Repozitory Technologies Pvt. Ltd.',
            'Aug 2023 – Present',
            'Hisar'
          ),
          createBullet('{{B1}}'),
          createBullet('{{B2}}'),
          createBullet('{{B3}}'),
          createBullet('{{B4}}'),
          createBullet('{{B5}}'),
          createBullet('{{B6}}'),

          // Previous Experience - Internshala (static)
          ...createExperienceHeader(
            'Python Development Intern',
            'Internshala',
            'May 2023 – Jul 2023',
            'Remote'
          ),
          createBullet('Built automation and data processing scripts using Python, Pandas, and Requests'),
          createBullet('Developed REST APIs and backend logic for server-side applications'),
          createBullet('Gained hands-on experience in debugging and API integration tasks'),

          // ============ PROJECTS ============
          ...createSectionHeader('Projects'),

          new Paragraph({
            children: [
              new TextRun({
                text: 'GetStatus – Urban Renewal Platform',
                bold: true,
                size: fontSize.normal,
              }),
            ],
            spacing: { before: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Enterprise platform for managing urban projects in Israel using React, Angular, Node.js, MongoDB. Improved stakeholder communication and project transparency.',
                size: fontSize.small,
                color: colors.secondary,
              }),
            ],
            spacing: { after: 80 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: 'HRMS Internal System',
                bold: true,
                size: fontSize.normal,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Full-stack HR management system with attendance integration, leave & loan modules, and responsive dashboards.',
                size: fontSize.small,
                color: colors.secondary,
              }),
            ],
            spacing: { after: 80 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: 'Bibico – Influencer Marketing Platform',
                bold: true,
                size: fontSize.normal,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Multi-language platform connecting brands and influencers with i18n, Express, Sequelize, and SQL.',
                size: fontSize.small,
                color: colors.secondary,
              }),
            ],
            spacing: { after: 80 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: 'Personal Portfolio – ajayluhach.in',
                bold: true,
                size: fontSize.normal,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Next.js portfolio with multi-theme setup, responsive design, animations, and SSR/SEO optimization.',
                size: fontSize.small,
                color: colors.secondary,
              }),
            ],
            spacing: { after: 100 },
          }),

          // ============ EDUCATION ============
          ...createSectionHeader('Education'),

          new Paragraph({
            children: [
              new TextRun({
                text: 'Diploma in Computer Engineering',
                bold: true,
                size: fontSize.normal,
              }),
              new TextRun({
                text: ' — Chhotu Ram Polytechnic, Rohtak',
                size: fontSize.normal,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Aug 2021 - July 2023 | 84%',
                size: fontSize.small,
                color: colors.secondary,
                italics: true,
              }),
            ],
            spacing: { after: 80 },
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: 'High School (Non-Medical)',
                bold: true,
                size: fontSize.normal,
              }),
              new TextRun({
                text: ' — Indus Public School, Jind',
                size: fontSize.normal,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'June 2017 - July 2019 | 78.8%',
                size: fontSize.small,
                color: colors.secondary,
                italics: true,
              }),
            ],
          }),
        ],
      },
    ],
  });

  // Generate and save
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  console.log('✅ Template created successfully!');
  console.log(`📄 Location: ${outputPath}\n`);
  console.log('Placeholders (AI-tailored for each job):');
  console.log('  {{SUMMARY}} - Professional summary');
  console.log('  {{SKILLS}}  - Technical skills');
  console.log('  {{B1}}-{{B6}} - Experience bullets for current role\n');
  console.log('Static content (unchanged):');
  console.log('  - Personal info, contact details');
  console.log('  - Previous experience (Internshala)');
  console.log('  - Projects section');
  console.log('  - Education section\n');
}

generateTemplate().catch(console.error);
