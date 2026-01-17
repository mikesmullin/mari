/**
 * Template substitution for command strings
 * Supports $VAR, ${VAR}, and $VAR:type:format syntax
 */

import { formatDate } from './date.js';

/**
 * Format a value with a type and format specifier
 * @param {any} value - The value to format
 * @param {string} type - The type (e.g., 'date')
 * @param {string} format - The format string (e.g., 'YYYY-MM-dd')
 * @returns {string} Formatted value
 */
function formatWithSpec(value, type, format) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  
  switch (type) {
    case 'date': {
      // Convert to Date if it's a string (e.g., ISO string)
      let date = value;
      if (typeof value === 'string') {
        date = new Date(value);
      }
      if (date instanceof Date && !isNaN(date.getTime())) {
        return formatDate(date, format);
      }
      return String(value);
    }
    default:
      return String(value);
  }
}

/**
 * Substitute variables in a template string
 * @param {string} template - Template with $VAR or ${VAR} placeholders
 * @param {object} variables - Variable name -> value mapping
 * @param {string} input - Optional $INPUT value
 * @returns {string} Substituted string
 */
export function substitute(template, variables, input = '') {
  let result = template;
  
  // Replace $INPUT first
  result = result.replace(/\$INPUT\b/g, input);
  result = result.replace(/\$\{INPUT\}/g, input);
  
  // Replace $VAR:type:format syntax (e.g., $SINCE:date:YYYY-MM-dd)
  result = result.replace(/\$([A-Z_][A-Z0-9_]*):(\w+):([^\s"']+)/g, (match, name, type, format) => {
    if (!variables.hasOwnProperty(name)) return match;
    return formatWithSpec(variables[name], type, format);
  });
  
  // Replace ${VAR:type:format} syntax
  result = result.replace(/\$\{([A-Z_][A-Z0-9_]*):(\w+):([^}]+)\}/g, (match, name, type, format) => {
    if (!variables.hasOwnProperty(name)) return match;
    return formatWithSpec(variables[name], type, format);
  });
  
  // Replace ${VAR} syntax
  result = result.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (match, name) => {
    return variables.hasOwnProperty(name) ? String(variables[name]) : match;
  });
  
  // Replace $VAR syntax (word boundary)
  result = result.replace(/\$([A-Z_][A-Z0-9_]*)\b/g, (match, name) => {
    return variables.hasOwnProperty(name) ? String(variables[name]) : match;
  });
  
  return result;
}

/**
 * Extract variable names from a template
 * @param {string} template - Template string
 * @returns {string[]} List of variable names
 */
export function extractVariables(template) {
  const vars = new Set();
  
  // Match ${VAR}
  const braceMatches = template.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g);
  for (const match of braceMatches) {
    vars.add(match[1]);
  }
  
  // Match $VAR
  const dollarMatches = template.matchAll(/\$([A-Z_][A-Z0-9_]*)\b/g);
  for (const match of dollarMatches) {
    vars.add(match[1]);
  }
  
  return Array.from(vars);
}
