/**
 * Validation utilities for variables
 */

/**
 * Validate a string against a regex pattern
 * @param {string} value - Value to validate
 * @param {string} pattern - Regex pattern string
 * @returns {boolean} True if valid
 */
export function validatePattern(value, pattern) {
  if (!pattern) return true;
  try {
    const regex = new RegExp(pattern);
    return regex.test(value);
  } catch (e) {
    return true; // Invalid pattern = no validation
  }
}

/**
 * Validate a number is within range
 * @param {number} value - Value to check
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {boolean} True if in range
 */
export function validateRange(value, min, max) {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/**
 * Validate a date is within range
 * @param {Date} value - Date to check
 * @param {Date} min - Minimum date
 * @param {Date} max - Maximum date
 * @returns {boolean} True if in range
 */
export function validateDateRange(value, min, max) {
  const time = value.getTime();
  if (min && time < min.getTime()) return false;
  if (max && time > max.getTime()) return false;
  return true;
}

/**
 * Validate an enum value
 * @param {string} value - Value to check
 * @param {string[]} options - Valid options
 * @returns {boolean} True if value is in options
 */
export function validateEnum(value, options) {
  if (!options || options.length === 0) return true;
  return options.includes(value);
}
