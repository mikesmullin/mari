/**
 * Printf-style format utilities
 * Supports: %d, %f, %.Nf, %s, %0Nd
 */

/**
 * Format a value using printf-style format string
 * @param {string} format - Format string (e.g., "%.2f", "%03d")
 * @param {any} value - Value to format
 * @returns {string} Formatted string
 */
export function sprintf(format, value) {
  if (!format || format === '') {
    return String(value);
  }
  
  // Match printf patterns: %[flags][width][.precision]specifier
  const match = format.match(/%(-?)(\d*)(?:\.(\d+))?([dfsxXeE%])/);
  
  if (!match) {
    // No format specifier, just return with prefix/suffix
    return format.replace(/%[dfs]/, String(value));
  }
  
  const [, leftAlign, width, precision, specifier] = match;
  const widthNum = parseInt(width, 10) || 0;
  const precisionNum = precision !== undefined ? parseInt(precision, 10) : undefined;
  
  let result;
  
  switch (specifier) {
    case 'd':
      result = Math.floor(Number(value)).toString();
      break;
      
    case 'f':
      const num = Number(value);
      result = precisionNum !== undefined 
        ? num.toFixed(precisionNum) 
        : num.toString();
      break;
      
    case 's':
      result = String(value);
      if (precisionNum !== undefined) {
        result = result.slice(0, precisionNum);
      }
      break;
      
    case 'x':
      result = Math.floor(Number(value)).toString(16);
      break;
      
    case 'X':
      result = Math.floor(Number(value)).toString(16).toUpperCase();
      break;
      
    case 'e':
      result = Number(value).toExponential(precisionNum);
      break;
      
    case 'E':
      result = Number(value).toExponential(precisionNum).toUpperCase();
      break;
      
    case '%':
      result = '%';
      break;
      
    default:
      result = String(value);
  }
  
  // Apply width padding
  if (widthNum > result.length) {
    const padChar = width.startsWith('0') && !leftAlign ? '0' : ' ';
    if (leftAlign) {
      result = result.padEnd(widthNum, ' ');
    } else {
      result = result.padStart(widthNum, padChar);
    }
  }
  
  // Replace format specifier in original string
  return format.replace(/%(-?)(\d*)(?:\.(\d+))?([dfsxXeE%])/, result);
}
