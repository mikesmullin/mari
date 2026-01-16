/**
 * Variable type system
 * Handles int, float, string, enum, date types
 */

import { sprintf } from '../utils/format.js';
import { formatDate, parseDate, parseDateRange, addDays } from '../utils/date.js';
import { validateRange, validateDateRange, validateEnum } from '../utils/validate.js';

/**
 * Evaluate a JavaScript expression for default value
 * @param {string} expr - JS expression string
 * @returns {any} Evaluated value
 */
export function evalDefault(expr) {
  if (typeof expr !== 'string') return expr;
  
  try {
    // Create a safe evaluation context
    const fn = new Function('return ' + expr);
    return fn();
  } catch (e) {
    return expr;
  }
}

/**
 * Get the runtime default value for a variable
 * Checks for 'value' first (literal), then 'default' (JS expression)
 * @param {object} def - Variable definition
 * @returns {any} Default value
 */
export function getDefaultValue(def) {
  // Check for persisted 'value' first (taken as literal)
  if (def.value !== undefined) {
    return parseLiteralValue(def.value, def);
  }
  
  // Fall back to 'default' (can be a JS expression)
  if (def.default !== undefined) {
    return evalDefault(def.default);
  }
  
  // Type-specific defaults
  switch (def.type) {
    case 'int':
      return 0;
    case 'float':
      return 0.0;
    case 'string':
      return '';
    case 'enum':
      return Array.isArray(def.range) && def.range.length > 0 
        ? def.range[0] 
        : '';
    case 'date':
      return new Date();
    default:
      return null;
  }
}

/**
 * Parse a literal value string into the correct type
 * Unlike evalDefault, this does not evaluate JS expressions
 * @param {any} value - Literal value from YAML
 * @param {object} def - Variable definition
 * @returns {any} Parsed value
 */
export function parseLiteralValue(value, def) {
  // If already the correct type, return as-is
  if (value === null || value === undefined) {
    return getDefaultValue({ ...def, value: undefined });
  }
  
  switch (def.type) {
    case 'int':
      return typeof value === 'number' ? Math.floor(value) : parseInt(String(value), 10);
    case 'float':
      return typeof value === 'number' ? value : parseFloat(String(value));
    case 'string':
      return String(value);
    case 'enum':
      return String(value);
    case 'date':
      // Parse ISO date string or other date formats
      if (value instanceof Date) return value;
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? new Date() : parsed;
    default:
      return value;
  }
}

/**
 * Parse user input into the correct type
 * @param {string} input - User input string
 * @param {object} def - Variable definition
 * @returns {any} Parsed value or null if invalid
 */
export function parseValue(input, def) {
  switch (def.type) {
    case 'int':
      const intVal = parseInt(input, 10);
      return isNaN(intVal) ? null : intVal;
      
    case 'float':
      const floatVal = parseFloat(input);
      return isNaN(floatVal) ? null : floatVal;
      
    case 'string':
      return input;
      
    case 'enum':
      if (Array.isArray(def.range) && def.range.includes(input)) {
        return input;
      }
      return null;
      
    case 'date':
      return parseDate(input);
      
    default:
      return input;
  }
}

/**
 * Format a value for display
 * @param {any} value - Value to format
 * @param {object} def - Variable definition
 * @returns {string} Formatted string
 */
export function formatValue(value, def) {
  if (value === null || value === undefined) {
    return '';
  }
  
  switch (def.type) {
    case 'int':
    case 'float':
      if (def.format) {
        return sprintf(def.format, value);
      }
      return String(value);
      
    case 'string':
    case 'enum':
      return String(value);
      
    case 'date':
      if (value instanceof Date) {
        return formatDate(value, def.format || 'M/d');
      }
      return String(value);
      
    default:
      return String(value);
  }
}

/**
 * Increment a value (for jog wheel / + key)
 * @param {any} value - Current value
 * @param {object} def - Variable definition
 * @param {number} amount - Increment amount (default: step or 1)
 * @returns {any} New value
 */
export function incrementValue(value, def, amount = 1) {
  const step = def.step || 1;
  const increment = step * amount;
  
  switch (def.type) {
    case 'int':
    case 'float': {
      let newVal = value + increment;
      // Clamp to range
      if (Array.isArray(def.range) && def.range.length === 2) {
        const [min, max] = def.range;
        newVal = Math.max(min, Math.min(max, newVal));
      }
      return def.type === 'int' ? Math.floor(newVal) : newVal;
    }
      
    case 'enum': {
      if (!Array.isArray(def.range) || def.range.length === 0) {
        return value;
      }
      const currentIdx = def.range.indexOf(value);
      const nextIdx = (currentIdx + 1) % def.range.length;
      return def.range[nextIdx];
    }
      
    case 'date': {
      if (!(value instanceof Date)) return value;
      let newDate = addDays(value, increment);
      // Clamp to range
      const range = parseDateRange(def.range);
      if (range) {
        if (newDate < range.min) newDate = range.min;
        if (newDate > range.max) newDate = range.max;
      }
      return newDate;
    }
      
    default:
      return value;
  }
}

/**
 * Decrement a value (for jog wheel / - key)
 * @param {any} value - Current value
 * @param {object} def - Variable definition
 * @param {number} amount - Decrement amount (default: step or 1)
 * @returns {any} New value
 */
export function decrementValue(value, def, amount = 1) {
  const step = def.step || 1;
  const decrement = step * amount;
  
  switch (def.type) {
    case 'int':
    case 'float': {
      let newVal = value - decrement;
      if (Array.isArray(def.range) && def.range.length === 2) {
        const [min, max] = def.range;
        newVal = Math.max(min, Math.min(max, newVal));
      }
      return def.type === 'int' ? Math.floor(newVal) : newVal;
    }
      
    case 'enum': {
      if (!Array.isArray(def.range) || def.range.length === 0) {
        return value;
      }
      const currentIdx = def.range.indexOf(value);
      const prevIdx = currentIdx <= 0 
        ? def.range.length - 1 
        : currentIdx - 1;
      return def.range[prevIdx];
    }
      
    case 'date': {
      if (!(value instanceof Date)) return value;
      let newDate = addDays(value, -decrement);
      const range = parseDateRange(def.range);
      if (range) {
        if (newDate < range.min) newDate = range.min;
        if (newDate > range.max) newDate = range.max;
      }
      return newDate;
    }
      
    default:
      return value;
  }
}

/**
 * Validate a value against its definition
 * @param {any} value - Value to validate
 * @param {object} def - Variable definition
 * @returns {boolean} True if valid
 */
export function isValidValue(value, def) {
  if (value === null || value === undefined) {
    return false;
  }
  
  switch (def.type) {
    case 'int':
    case 'float':
      if (typeof value !== 'number' || isNaN(value)) return false;
      if (Array.isArray(def.range) && def.range.length === 2) {
        return validateRange(value, def.range[0], def.range[1]);
      }
      return true;
      
    case 'string':
      return typeof value === 'string';
      
    case 'enum':
      return validateEnum(value, def.range);
      
    case 'date':
      if (!(value instanceof Date) || isNaN(value.getTime())) return false;
      const range = parseDateRange(def.range);
      if (range) {
        return validateDateRange(value, range.min, range.max);
      }
      return true;
      
    default:
      return true;
  }
}
