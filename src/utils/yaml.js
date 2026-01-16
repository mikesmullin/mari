/**
 * YAML utilities - uses Bun's built-in YAML parser for reading
 * and js-yaml for writing (better formatting)
 */

import jsYaml from 'js-yaml';

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
 * Uses js-yaml for better multi-line formatting
 * @param {object} obj - Object to stringify
 * @returns {string} YAML string
 */
export function stringifyYaml(obj) {
  return jsYaml.dump(obj, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
}
