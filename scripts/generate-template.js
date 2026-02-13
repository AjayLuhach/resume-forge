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
 * - {{B1}}-{{B5}} - Experience bullet points (tailored)
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
const resumeDataPath = join(__dirname, '..', 'resumeData.json');

// Load resume data
const resumeData = JSON.parse(fs.readFileSync(resumeDataPath, 'utf-8'));

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

  // Extract data from resumeData.json
  const { personalInfo, contact } = resumeData;
  const currentJob = resumeData.experience?.find(exp => exp.isCurrent) || resumeData.experience?.[0];
  const previousJobs = resumeData.experience?.filter(exp => !exp.isCurrent) || [];
  const education = resumeData.education || [];
  const personalProjects = resumeData.projects || [];

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
                text: personalInfo?.name || 'Your Name',
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
                text: `${personalInfo?.location || ''} | ${contact?.email || ''} | ${contact?.phone || ''}`,
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
                text: `${contact?.github || ''} | ${contact?.linkedin || ''} | ${contact?.portfolio || ''}`,
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

          // Current Job (with AI-tailored bullets)
          ...createExperienceHeader(
            currentJob?.title || 'Job Title',
            currentJob?.company || 'Company',
            currentJob?.duration || 'Duration',
            currentJob?.location || 'Location'
          ),
          createBullet('{{B1}}'),
          createBullet('{{B2}}'),
          createBullet('{{B3}}'),
          createBullet('{{B4}}'),
          createBullet('{{B5}}'),

          // Previous Experience (static bullets from resumeData.json)
          ...(previousJobs.flatMap(job => [
            ...createExperienceHeader(
              job.title || 'Job Title',
              job.company || 'Company',
              job.duration || 'Duration',
              job.location || 'Location'
            ),
            ...(job.bullets || []).map(bullet => createBullet(bullet)),
          ])),

          // ============ PROJECTS ============
          ...createSectionHeader('Projects'),

          // Personal projects from resumeData.json (AI-tailored descriptions)
          ...(personalProjects.flatMap((project, index) => {
            const projectKey = project.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const isLast = index === personalProjects.length - 1;

            return [
              new Paragraph({
                children: [
                  new TextRun({
                    text: project.name || 'Project Name',
                    bold: true,
                    size: fontSize.normal,
                  }),
                ],
                spacing: { before: index === 0 ? 80 : 0 },
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `{{P_${projectKey}}}`,
                    size: fontSize.small,
                    color: colors.secondary,
                  }),
                ],
                spacing: { after: isLast ? 100 : 80 },
              }),
            ];
          })),

          // ============ EDUCATION ============
          ...createSectionHeader('Education'),

          // Education entries from resumeData.json
          ...(education.flatMap(edu => [
            new Paragraph({
              children: [
                new TextRun({
                  text: edu.degree || 'Degree',
                  bold: true,
                  size: fontSize.normal,
                }),
                new TextRun({
                  text: ` — ${edu.institution || 'Institution'}`,
                  size: fontSize.normal,
                }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `${edu.duration || 'Duration'}${edu.score ? ' | ' + edu.score : ''}`,
                  size: fontSize.small,
                  color: colors.secondary,
                  italics: true,
                }),
              ],
              spacing: { after: 80 },
            }),
          ])),
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
  console.log('  {{SUMMARY}}       - Professional summary');
  console.log('  {{SKILLS}}        - Technical skills');
  console.log('  {{B1}}-{{B5}}     - Experience bullets (mention work projects by name)');

  // Show personal project placeholders dynamically
  (resumeData.projects || []).forEach(project => {
    const projectKey = project.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    console.log(`  {{P_${projectKey}}} - ${project.name} description`);
  });

  console.log('\nStatic content (unchanged):');
  console.log('  - Personal info, contact details');
  console.log('  - Previous experience bullets');
  console.log('  - Education section\n');
}

generateTemplate().catch(console.error);
