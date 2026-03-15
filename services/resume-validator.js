/**
 * Validates resumeData.json structure.
 * Returns { valid, errors[], warnings[], summary }
 */

const SCHEMA = {
  personalInfo: {
    required: ['name', 'email'],
    optional: ['dob', 'phone', 'location', 'linkedin', 'github', 'portfolio'],
    types: { name: 'string', email: 'string', dob: 'string', phone: 'string', location: 'string', linkedin: 'string', github: 'string', portfolio: 'string' },
  },
  meta: {
    required: ['experienceStart', 'stack'],
    optional: ['primaryCloud', 'coreProjects', 'selectableProjects', 'editableProjects', 'cannotClaim'],
    types: { experienceStart: 'string', stack: 'string', primaryCloud: 'string', coreProjects: 'array', selectableProjects: 'array', editableProjects: 'array', cannotClaim: 'array' },
  },
  professionalSummary: {
    required: ['default'],
    optional: ['keywords'],
    types: { default: 'string', keywords: 'array' },
  },
  skills: {
    required: ['frontend', 'backend'],
    optional: ['toolsDevOps', 'other'],
    types: { frontend: 'array', backend: 'array', toolsDevOps: 'array', other: 'array' },
  },
  experience: {
    isArray: true,
    itemRequired: ['company', 'title', 'duration'],
    itemOptional: ['location', 'isCurrent', 'projects', 'bullets'],
    itemTypes: { company: 'string', title: 'string', duration: 'string', location: 'string', isCurrent: 'boolean', projects: 'array', bullets: 'array' },
  },
  projects: {
    isArray: true,
    itemRequired: ['name', 'description'],
    itemOptional: ['coreTech', 'stackUsed'],
    itemTypes: { name: 'string', description: 'string', coreTech: 'array', stackUsed: 'object' },
  },
  education: {
    isArray: true,
    itemRequired: ['degree', 'institution'],
    itemOptional: ['field', 'duration', 'score'],
    itemTypes: { degree: 'string', institution: 'string', field: 'string', duration: 'string', score: 'string' },
  },
};

// Experience project sub-schema
const PROJECT_SCHEMA = {
  required: ['name', 'description'],
  optional: ['coreTech', 'stackUsed'],
  types: { name: 'string', description: 'string', coreTech: 'array', stackUsed: 'object' },
};

function checkType(value, expected) {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return typeof value === 'object' && !Array.isArray(value) && value !== null;
  return typeof value === expected;
}

export function validateResumeData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Resume data must be a JSON object'], warnings, summary: null };
  }

  // Check top-level sections
  const topLevelRequired = ['personalInfo', 'meta', 'professionalSummary', 'skills', 'experience', 'projects'];
  const topLevelOptional = ['education'];

  for (const section of topLevelRequired) {
    if (!(section in data)) {
      errors.push(`Missing required section: "${section}"`);
    }
  }

  for (const section of topLevelOptional) {
    if (!(section in data)) {
      warnings.push(`Missing optional section: "${section}"`);
    }
  }

  // Validate object sections
  for (const [section, schema] of Object.entries(SCHEMA)) {
    if (!(section in data)) continue;
    const sectionData = data[section];

    if (schema.isArray) {
      // Array sections (experience, projects, education)
      if (!Array.isArray(sectionData)) {
        errors.push(`"${section}" must be an array`);
        continue;
      }
      if (sectionData.length === 0) {
        warnings.push(`"${section}" is empty`);
        continue;
      }

      sectionData.forEach((item, i) => {
        if (typeof item !== 'object' || item === null) {
          errors.push(`${section}[${i}] must be an object`);
          return;
        }

        for (const field of schema.itemRequired) {
          if (!(field in item)) {
            errors.push(`${section}[${i}] missing required field: "${field}"`);
          } else if (schema.itemTypes[field] && !checkType(item[field], schema.itemTypes[field])) {
            errors.push(`${section}[${i}].${field} must be ${schema.itemTypes[field]}`);
          }
        }

        // Validate nested experience projects
        if (section === 'experience' && item.projects) {
          if (!Array.isArray(item.projects)) {
            errors.push(`${section}[${i}].projects must be an array`);
          } else {
            item.projects.forEach((proj, j) => {
              for (const field of PROJECT_SCHEMA.required) {
                if (!(field in proj)) {
                  errors.push(`${section}[${i}].projects[${j}] missing required field: "${field}"`);
                }
              }
              if (proj.description && proj.description.length < 50) {
                warnings.push(`${section}[${i}].projects[${j}].description is very short (${proj.description.length} chars) — aim for 100+ chars`);
              }
            });
          }
        }
      });
    } else {
      // Object sections
      if (typeof sectionData !== 'object' || Array.isArray(sectionData)) {
        errors.push(`"${section}" must be an object`);
        continue;
      }

      for (const field of schema.required) {
        if (!(field in sectionData)) {
          errors.push(`${section} missing required field: "${field}"`);
        } else if (schema.types[field] && !checkType(sectionData[field], schema.types[field])) {
          errors.push(`${section}.${field} must be ${schema.types[field]}`);
        }
      }
    }
  }

  // Content quality warnings
  if (data.personalInfo?.name && data.personalInfo.name.length < 2) {
    warnings.push('personalInfo.name seems too short');
  }
  if (data.personalInfo?.email && !data.personalInfo.email.includes('@')) {
    errors.push('personalInfo.email is not a valid email address');
  }
  if (data.meta?.experienceStart && !/^[A-Z][a-z]{2}\s\d{4}$/.test(data.meta.experienceStart)) {
    warnings.push('meta.experienceStart should be in "Mon YYYY" format (e.g., "Jun 2022")');
  }
  if (data.professionalSummary?.default && data.professionalSummary.default.length < 50) {
    warnings.push('professionalSummary.default is very short — aim for 200+ characters');
  }
  if (data.skills) {
    const allSkills = [...(data.skills.frontend || []), ...(data.skills.backend || []), ...(data.skills.toolsDevOps || []), ...(data.skills.other || [])];
    if (allSkills.length < 5) {
      warnings.push('Very few skills listed — the more skills you list, the better keyword matching works');
    }
  }
  if (data.meta?.coreProjects && data.experience) {
    const workProjectNames = data.experience.flatMap(e => (e.projects || []).map(p => p.name));
    for (const core of data.meta.coreProjects) {
      if (!workProjectNames.some(n => n.includes(core))) {
        warnings.push(`meta.coreProjects references "${core}" but no matching work project found`);
      }
    }
  }

  // Build summary
  const summary = {
    name: data.personalInfo?.name || 'Unknown',
    stack: data.meta?.stack || 'Unknown',
    skillCount: data.skills
      ? [...(data.skills.frontend || []), ...(data.skills.backend || []), ...(data.skills.toolsDevOps || []), ...(data.skills.other || [])].length
      : 0,
    workProjects: data.experience
      ? data.experience.reduce((sum, e) => sum + (e.projects?.length || 0), 0)
      : 0,
    personalProjects: data.projects?.length || 0,
    experienceEntries: data.experience?.length || 0,
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary,
  };
}
