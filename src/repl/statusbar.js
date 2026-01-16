/**
 * Statusbar rendering
 * Displays activity, command buffer, and state
 */

import { store } from '../commands/store.js';
import { formatValue } from '../config/variables.js';

// ANSI escape codes
const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const INVERT = `${ESC}[7m`;
const FG_BLACK = `${ESC}[30m`;
const FG_WHITE = `${ESC}[37m`;
const FG_CYAN = `${ESC}[36m`;
const FG_YELLOW = `${ESC}[33m`;
const FG_GREEN = `${ESC}[32m`;
const FG_MAGENTA = `${ESC}[35m`;
const BG_BLUE = `${ESC}[44m`;
const BG_BLACK = `${ESC}[40m`;

// Color name to ANSI code map
const BG_COLORS = {
  black: `${ESC}[40m`,
  red: `${ESC}[41m`,
  green: `${ESC}[42m`,
  yellow: `${ESC}[43m`,
  blue: `${ESC}[44m`,
  magenta: `${ESC}[45m`,
  cyan: `${ESC}[46m`,
  white: `${ESC}[47m`,
  // Bright variants
  brightBlack: `${ESC}[100m`,
  brightRed: `${ESC}[101m`,
  brightGreen: `${ESC}[102m`,
  brightYellow: `${ESC}[103m`,
  brightBlue: `${ESC}[104m`,
  brightMagenta: `${ESC}[105m`,
  brightCyan: `${ESC}[106m`,
  brightWhite: `${ESC}[107m`,
};

/**
 * Parse hex color to RGB values
 * @param {string} hex - Hex color string (e.g., "#3a86ff" or "3a86ff")
 * @returns {{r: number, g: number, b: number}|null} RGB values or null if invalid
 */
function parseHexColor(hex) {
  const match = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  
  const hexValue = match[1];
  return {
    r: parseInt(hexValue.slice(0, 2), 16),
    g: parseInt(hexValue.slice(2, 4), 16),
    b: parseInt(hexValue.slice(4, 6), 16),
  };
}

/**
 * Get background color ANSI code
 * Supports named colors and hex format (e.g., "#3a86ff")
 * @param {string} color - Color name or hex value
 * @returns {string} ANSI escape sequence
 */
function getBgColor(color) {
  if (!color) return BG_COLORS.blue;
  
  // Check for hex format
  if (color.startsWith('#') || /^[0-9a-fA-F]{6}$/.test(color)) {
    const rgb = parseHexColor(color);
    if (rgb) {
      // ANSI 24-bit color: ESC[48;2;R;G;Bm
      return `${ESC}[48;2;${rgb.r};${rgb.g};${rgb.b}m`;
    }
  }
  
  // Named color
  return BG_COLORS[color] || BG_COLORS.blue;
}

/**
 * Get terminal dimensions
 * @returns {{cols: number, rows: number}}
 */
export function getTermSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24
  };
}

/**
 * Move cursor to position
 * @param {number} row - Row (1-indexed)
 * @param {number} col - Column (1-indexed)
 * @returns {string} ANSI escape sequence
 */
export function moveTo(row, col) {
  return `${ESC}[${row};${col}H`;
}

/**
 * Clear line
 * @returns {string} ANSI escape sequence
 */
export function clearLine() {
  return `${ESC}[2K`;
}

/**
 * Hide cursor
 * @returns {string} ANSI escape sequence
 */
export function hideCursor() {
  return `${ESC}[?25l`;
}

/**
 * Show cursor
 * @returns {string} ANSI escape sequence
 */
export function showCursor() {
  return `${ESC}[?25h`;
}

/**
 * Clear screen
 * @returns {string} ANSI escape sequence
 */
export function clearScreen() {
  return `${ESC}[2J${ESC}[H`;
}

/**
 * Move cursor up N lines
 * @param {number} n - Number of lines
 * @returns {string} ANSI escape sequence
 */
export function moveUp(n = 1) {
  return `${ESC}[${n}A`;
}

/**
 * Clear from cursor to end of line
 * @returns {string} ANSI escape sequence
 */
export function clearToEOL() {
  return `${ESC}[K`;
}

/**
 * Save cursor position
 * @returns {string} ANSI escape sequence
 */
export function saveCursor() {
  return `${ESC}7`;
}

/**
 * Restore cursor position
 * @returns {string} ANSI escape sequence
 */
export function restoreCursor() {
  return `${ESC}8`;
}

/**
 * Set scroll region (limits scrolling to rows 1 to n)
 * @param {number} top - Top row (1-indexed)
 * @param {number} bottom - Bottom row (1-indexed)
 * @returns {string} ANSI escape sequence
 */
export function setScrollRegion(top, bottom) {
  return `${ESC}[${top};${bottom}r`;
}

/**
 * Reset scroll region to full screen
 * @returns {string} ANSI escape sequence
 */
export function resetScrollRegion() {
  return `${ESC}[r`;
}

/**
 * Format the activity badge
 * @param {string} name - Activity name
 * @param {string} color - Background color name or hex value (optional)
 * @returns {string} Formatted badge
 */
function formatActivityBadge(name, color = 'blue') {
  const bgColor = getBgColor(color);
  return `${BOLD}${bgColor}${FG_WHITE} ${name || 'none'} ${RESET}`;
}

/**
 * Format the mode indicator
 * @param {string} mode - Current mode
 * @returns {string} Formatted mode
 */
function formatMode(mode) {
  switch (mode) {
    case 'NORMAL':
      return `${DIM}-- NORMAL --${RESET}`;
    case 'CMD':
      return `${FG_CYAN}-- CMD --${RESET}`;
    case 'INPUT':
      return `${FG_YELLOW}-- INPUT --${RESET}`;
    case 'AGENT':
      return `${FG_MAGENTA}-- AGENT --${RESET}`;
    default:
      return '';
  }
}

/**
 * Format variable display for INPUT mode
 * @param {string} activeVar - Currently active variable
 * @returns {string} Formatted variable line
 */
function formatVariables(activeVar) {
  const data = store.getCurrentActivity();
  if (!data) return '';
  
  const hotkeyBg = getBgColor('#3a86ff');
  const parts = [];
  for (const [name, def] of Object.entries(data.definitions)) {
    const value = data.values[name];
    const formatted = formatValue(value, def);
    const hotkey = def.hotkey ? `${hotkeyBg}${FG_WHITE}${def.hotkey}${RESET} ` : '';
    
    if (name === activeVar) {
      parts.push(`${hotkey}${INVERT}${name}:${formatted}${RESET}`);
    } else {
      parts.push(`${hotkey}${name}:${formatted}`);
    }
  }
  
  return parts.join('  ');
}

/**
 * Format context summary for statusbar
 * @returns {string} Context string (e.g., "5x IWM 1/17 225p @ $0.45")
 */
function formatContext() {
  const data = store.getCurrentActivity();
  if (!data) return '';
  
  const values = data.values;
  const defs = data.definitions;
  const activity = data.activity;
  
  // Use custom statusFormat if provided in activity YAML
  if (activity.statusFormat) {
    return formatStatusTemplate(activity.statusFormat, values, defs);
  }
  
  // Default format for trading-like variables
  const qty = values.QTY;
  const symbol = values.SYMBOL;
  const exp = values.EXP;
  const strike = values.STRIKE;
  const type = values.TYPE;
  const price = values.PRICE;
  
  if (symbol && qty !== undefined) {
    let ctx = `${qty}x ${symbol}`;
    if (exp) {
      const expStr = formatValue(exp, defs.EXP || { type: 'date', format: 'M/d' });
      ctx += ` ${expStr}`;
    }
    if (strike !== undefined) {
      ctx += ` ${strike}`;
    }
    if (type) {
      ctx += type.charAt(0).toLowerCase(); // 'c' or 'p'
    }
    if (price !== undefined) {
      ctx += ` @ $${price}`;
    }
    return ctx;
  }
  
  return '';
}

/**
 * Format status template with variable substitution
 * Supports modifiers: ${VAR:short} for first character
 * Variables are referenced as $VAR or ${VAR}
 * @param {string} template - Status format template
 * @param {object} values - Variable values
 * @param {object} defs - Variable definitions
 * @returns {string} Formatted status string
 */
function formatStatusTemplate(template, values, defs) {
  let result = template;
  
  // Replace ${VAR:modifier} with formatted values
  result = result.replace(/\$\{(\w+)(?::(\w+))?\}/g, (match, name, modifier) => {
    if (values[name] !== undefined) {
      let val = defs[name] ? formatValue(values[name], defs[name]) : String(values[name]);
      if (modifier === 'short') {
        val = String(val).charAt(0).toLowerCase();
      }
      return val;
    }
    return match;
  });
  
  result = result.replace(/\$(\w+)/g, (match, name) => {
    if (values[name] !== undefined) {
      return defs[name] ? formatValue(values[name], defs[name]) : String(values[name]);
    }
    return match;
  });
  
  return result;
}

// Default color palette for activities without explicit color
const DEFAULT_ACTIVITY_COLORS = [
  "#005f73", "#0a9396", "#94d2bd", "#e9d8a6", "#ee9b00", 
  "#ca6702", "#bb3e03", "#ae2012", "#9b2226", "#001219",
];

/**
 * Render the statusbar
 * @param {object} state - Current state
 * @returns {string} Rendered statusbar
 */
export function renderStatusbar(state) {
  const { cols, rows } = getTermSize();
  const activityName = store.getCurrentActivityName();
  const activityData = store.getCurrentActivity();
  
  // Use explicit color or default based on activity index
  let activityColor = activityData?.activity?.color;
  if (!activityColor) {
    const activityIndex = store.getActivityIndex(activityName);
    activityColor = DEFAULT_ACTIVITY_COLORS[activityIndex % DEFAULT_ACTIVITY_COLORS.length];
  }
  
  // Build components
  const activity = formatActivityBadge(activityName, activityColor);
  const buffer = state.buffer || '';
  const cursor = '█';
  const mode = formatMode(state.mode);
  const context = formatContext();
  
  // Calculate visible width (strip ANSI codes for width calculation)
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  
  // Left side: [activity] buffer█
  const leftContent = `${activity} ${buffer}${cursor}`;
  const leftWidth = stripAnsi(activity).length + 1 + buffer.length + 1;
  
  // Right side: context  mode
  const rightContent = context ? `${context}  ${mode}` : mode;
  const rightWidth = stripAnsi(rightContent).length;
  
  // Calculate padding
  const padding = Math.max(0, cols - leftWidth - rightWidth);
  
  // Build the line
  let line = leftContent + ' '.repeat(padding) + rightContent;
  
  // Ensure we don't exceed terminal width
  if (stripAnsi(line).length > cols) {
    line = leftContent.slice(0, cols - rightWidth - 3) + '...' + rightContent;
  }
  
  return line;
}

/**
 * Render variable display line (shown in INPUT mode)
 * @param {string} activeVar - Active variable name
 * @returns {string} Formatted line
 */
export function renderVariableLine(activeVar) {
  const vars = formatVariables(activeVar);
  return vars || '';
}

// Track current status bar height for clearing
let currentStatusHeight = 1;

/**
 * Get the number of status bar lines (1 for normal, 2 for INPUT mode with var line)
 * @param {object} state - Current state
 * @returns {number} Number of status bar lines
 */
function getStatusHeight(state) {
  return state.mode === 'INPUT' ? 2 : 1;
}

/**
 * Initialize the terminal for REPL mode
 * Sets up scroll region and clears screen
 * @param {object} state - Current state
 */
export function initTerminal(state) {
  const { rows } = getTermSize();
  currentStatusHeight = getStatusHeight(state);
  const scrollBottom = rows - currentStatusHeight;
  
  let init = '';
  init += hideCursor();
  init += clearScreen();
  init += setScrollRegion(1, scrollBottom);
  init += moveTo(1, 1);  // Position cursor at top of scroll region
  init += showCursor();
  
  process.stdout.write(init);
  
  // Draw initial status bar
  renderStatusOnly(state);
}

/**
 * Reset terminal to normal state
 */
export function resetTerminal() {
  let reset = '';
  reset += resetScrollRegion();
  reset += showCursor();
  process.stdout.write(reset);
}

/**
 * Render only the status bar (bottom lines)
 * Used when status needs updating without printing output
 * @param {object} state - Current state
 */
export function renderStatusOnly(state) {
  const { rows } = getTermSize();
  const newHeight = getStatusHeight(state);
  
  let screen = '';
  screen += hideCursor();
  screen += saveCursor();
  
  // Clear old status lines (clear the max of old and new to handle shrinking)
  const clearHeight = Math.max(currentStatusHeight, newHeight);
  for (let i = 0; i < clearHeight; i++) {
    screen += moveTo(rows - i, 1) + clearLine();
  }
  
  // Update scroll region if height changed
  if (newHeight !== currentStatusHeight) {
    currentStatusHeight = newHeight;
    const scrollBottom = rows - currentStatusHeight;
    screen += setScrollRegion(1, scrollBottom);
  }
  
  // Variable line (if in INPUT mode)
  if (state.mode === 'INPUT') {
    const varLine = renderVariableLine(state.inputVar);
    screen += moveTo(rows - 1, 1) + varLine;
  }
  
  // Statusbar (last row)
  const statusbar = renderStatusbar(state);
  screen += moveTo(rows, 1) + statusbar;
  
  screen += restoreCursor();
  screen += showCursor();
  
  process.stdout.write(screen);
}

/**
 * Print output line(s) and refresh status bar
 * Output scrolls naturally within the scroll region
 * @param {string} text - Text to output (can contain newlines)
 * @param {object} state - Current state for status bar
 */
export function printOutput(text, state) {
  const { rows } = getTermSize();
  const statusHeight = getStatusHeight(state);
  
  // Ensure scroll region is correct
  if (statusHeight !== currentStatusHeight) {
    currentStatusHeight = statusHeight;
    const scrollBottom = rows - currentStatusHeight;
    process.stdout.write(setScrollRegion(1, scrollBottom));
  }
  
  let out = '';
  out += hideCursor();
  out += saveCursor();
  
  // Move to bottom of scroll region and print
  // The scroll region will handle scrolling automatically
  const scrollBottom = rows - currentStatusHeight;
  out += moveTo(scrollBottom, 1);
  out += '\n' + text;  // Newline triggers scroll if needed
  
  out += restoreCursor();
  
  process.stdout.write(out);
  
  // Redraw status bar (it might have been overwritten during scroll)
  renderStatusOnly(state);
}

/**
 * Full render to terminal (legacy - for initial render or full refresh)
 * @param {object} state - Current state
 * @param {string[]} output - Output lines to display (ignored in new approach)
 */
export function render(state, output = []) {
  // Just update status bar - output is handled separately via printOutput
  renderStatusOnly(state);
}
