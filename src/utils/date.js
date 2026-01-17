/**
 * Date formatting utilities
 * Supports: M, MM, d, dd, yy, yyyy tokens
 */

/**
 * Format a date using a pattern
 * @param {Date} date - Date to format
 * @param {string} pattern - Format pattern
 * @returns {string} Formatted date string
 */
export function formatDate(date, pattern = 'M/d') {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const yearShort = year % 100;
  
  let result = pattern;
  
  // Order matters: longer tokens first
  result = result.replace(/yyyy/ig, String(year));
  result = result.replace(/yy/ig, String(yearShort).padStart(2, '0'));
  result = result.replace(/MM/g, String(month).padStart(2, '0'));
  result = result.replace(/M/g, String(month));
  result = result.replace(/dd/g, String(day).padStart(2, '0'));
  result = result.replace(/d/g, String(day));
  
  return result;
}

/**
 * Parse a date string using common formats
 * @param {string} str - Date string (M/d, MM/dd, M/d/yy, etc.)
 * @param {number} defaultYear - Default year if not specified
 * @returns {Date|null} Parsed date or null
 */
export function parseDate(str, defaultYear = new Date().getFullYear()) {
  if (!str) return null;
  
  str = str.trim();
  
  // ISO format: YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  
  // M/d/yy or M/d/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str)) {
    const parts = str.split('/').map(Number);
    let year = parts[2];
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }
    return new Date(year, parts[0] - 1, parts[1]);
  }
  
  // M/d (no year - use default)
  if (/^\d{1,2}\/\d{1,2}$/.test(str)) {
    const [m, d] = str.split('/').map(Number);
    return new Date(defaultYear, m - 1, d);
  }
  
  return null;
}

/**
 * Parse a date range string (YYYY-MM-DD..YYYY-MM-DD)
 * @param {string} rangeStr - Range string
 * @returns {{min: Date, max: Date}|null} Parsed range or null
 */
export function parseDateRange(rangeStr) {
  if (!rangeStr || !rangeStr.includes('..')) return null;
  
  const parts = rangeStr.split('..');
  if (parts.length !== 2) return null;
  
  const min = parseDate(parts[0].trim());
  const max = parseDate(parts[1].trim());
  
  if (!min || !max) return null;
  
  return { min, max };
}

/**
 * Add days to a date
 * @param {Date} date - Base date
 * @param {number} days - Days to add (negative to subtract)
 * @returns {Date} New date
 */
export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
