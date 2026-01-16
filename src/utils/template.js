/**
 * Template substitution for command strings
 * Supports $VAR and ${VAR} syntax
 */

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
