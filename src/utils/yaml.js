/**
 * YAML utilities - uses Bun's built-in YAML parser
 */

/**
 * Parse a YAML string into a JavaScript object
 * @param {string} text - YAML text
 * @returns {object} Parsed object
 */
export function parseYaml(text) {
  return Bun.YAML.parse(text);
}

/**
 * Stringify a JavaScript object to YAML
 * @param {object} obj - Object to stringify
 * @returns {string} YAML string
 */
export function stringifyYaml(obj) {
  return Bun.YAML.stringify(obj);
}
