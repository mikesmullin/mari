/**
 * Activity schema validation
 */

const VALID_TYPES = ['int', 'float', 'string', 'enum', 'date'];

/**
 * Validate an activity object
 * @param {object} activity - Parsed activity object
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
export function validateActivity(activity) {
  const errors = [];
  
  // Required fields
  if (!activity.name || typeof activity.name !== 'string') {
    errors.push('Activity must have a "name" field (string)');
  }
  
  // Validate variables
  if (activity.variables) {
    if (typeof activity.variables !== 'object') {
      errors.push('"variables" must be an object');
    } else {
      for (const [name, def] of Object.entries(activity.variables)) {
        const varErrors = validateVariable(name, def);
        errors.push(...varErrors);
      }
    }
  }
  
  // Validate commands
  if (activity.commands) {
    if (typeof activity.commands !== 'object') {
      errors.push('"commands" must be an object');
    } else {
      for (const [key, cmd] of Object.entries(activity.commands)) {
        // Commands can be either a string or an object with shell and optional llm_prepend
        if (typeof cmd === 'string') {
          // Simple command string - valid
        } else if (typeof cmd === 'object' && cmd !== null) {
          // Command object - validate structure
          if (!cmd.shell || typeof cmd.shell !== 'string') {
            errors.push(`Command "${key}" object must have a "shell" field (string)`);
          }
          if (cmd.llm_prepend !== undefined && typeof cmd.llm_prepend !== 'string') {
            errors.push(`Command "${key}.llm_prepend" must be a string`);
          }
          if (cmd.description !== undefined && typeof cmd.description !== 'string') {
            errors.push(`Command "${key}.description" must be a string`);
          }
        } else {
          errors.push(`Command "${key}" must be a string or object with shell property`);
        }
      }
    }
  }
  
  // Validate aliases
  if (activity.aliases) {
    if (typeof activity.aliases !== 'object') {
      errors.push('"aliases" must be an object');
    }
  }
  
  // Validate llm_context (optional, string)
  if (activity.llm_context !== undefined && typeof activity.llm_context !== 'string') {
    errors.push('"llm_context" must be a string');
  }
  
  // Validate skills (optional, array of skill objects)
  if (activity.skills) {
    if (!Array.isArray(activity.skills)) {
      errors.push('"skills" must be an array');
    } else {
      for (let i = 0; i < activity.skills.length; i++) {
        const skill = activity.skills[i];
        const skillErrors = validateSkill(i, skill);
        errors.push(...skillErrors);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate a skill definition
 * @param {number} index - Skill index in array
 * @param {object} skill - Skill definition
 * @returns {string[]} List of errors
 */
function validateSkill(index, skill) {
  const errors = [];
  const prefix = `skills[${index}]`;
  
  if (!skill || typeof skill !== 'object') {
    errors.push(`${prefix}: must be an object`);
    return errors;
  }
  
  // Pattern is required
  if (!skill.pattern || typeof skill.pattern !== 'string') {
    errors.push(`${prefix}: must have a "pattern" field (string regex)`);
  } else {
    // Validate regex is parseable
    try {
      new RegExp(skill.pattern, 'i');
    } catch (err) {
      errors.push(`${prefix}: pattern is not a valid regex: ${err.message}`);
    }
  }
  
  // llm_prepend is required
  if (!skill.llm_prepend || typeof skill.llm_prepend !== 'string') {
    errors.push(`${prefix}: must have an "llm_prepend" field (string)`);
  }
  
  return errors;
}

/**
 * Validate a variable definition
 * @param {string} name - Variable name
 * @param {object} def - Variable definition
 * @returns {string[]} List of errors
 */
function validateVariable(name, def) {
  const errors = [];
  const prefix = `Variable "${name}"`;
  
  if (!def || typeof def !== 'object') {
    errors.push(`${prefix}: must be an object`);
    return errors;
  }
  
  // Type is required
  if (!def.type) {
    errors.push(`${prefix}: must have a "type" field`);
  } else if (!VALID_TYPES.includes(def.type)) {
    errors.push(`${prefix}: type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  
  // Validate range based on type
  if (def.range) {
    switch (def.type) {
      case 'int':
      case 'float':
        if (!Array.isArray(def.range) || def.range.length !== 2) {
          errors.push(`${prefix}: range for ${def.type} must be [min, max]`);
        }
        break;
        
      case 'enum':
        if (!Array.isArray(def.range) || def.range.length === 0) {
          errors.push(`${prefix}: range for enum must be an array of values`);
        }
        break;
        
      case 'date':
        if (typeof def.range !== 'string' || !def.range.includes('..')) {
          errors.push(`${prefix}: range for date must be "YYYY-MM-DD..YYYY-MM-DD"`);
        }
        break;
    }
  }
  
  // Validate step
  if (def.step !== undefined) {
    if (typeof def.step !== 'number' || def.step <= 0) {
      errors.push(`${prefix}: step must be a positive number`);
    }
  }
  
  // Validate hotkey
  if (def.hotkey !== undefined) {
    if (typeof def.hotkey !== 'string' || def.hotkey.length !== 1) {
      errors.push(`${prefix}: hotkey must be a single character`);
    }
  }
  
  return errors;
}

/**
 * Get default schema for activity
 * @returns {object} Default activity structure
 */
export function getDefaultActivity() {
  return {
    name: 'default',
    description: '',
    variables: {},
    commands: {},
    aliases: {},
    jog: {}
  };
}
