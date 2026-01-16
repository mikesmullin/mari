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
 * Format the activity badge
 * @param {string} name - Activity name
 * @param {string} color - Background color name (optional)
 * @returns {string} Formatted badge
 */
function formatActivityBadge(name, color = 'blue') {
  const bgColor = BG_COLORS[color] || BG_COLORS.blue;
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
  
  const parts = [];
  for (const [name, def] of Object.entries(data.definitions)) {
    const value = data.values[name];
    const formatted = formatValue(value, def);
    const hotkey = def.hotkey ? `${BG_COLORS.blue}${FG_WHITE}${def.hotkey}${RESET} ` : '';
    
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

/**
 * Render the statusbar
 * @param {object} state - Current state
 * @returns {string} Rendered statusbar
 */
export function renderStatusbar(state) {
  const { cols, rows } = getTermSize();
  const activityName = store.getCurrentActivityName();
  const activityData = store.getCurrentActivity();
  const activityColor = activityData?.activity?.color || 'blue';
  
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

/**
 * Full render to terminal
 * @param {object} state - Current state
 * @param {string[]} output - Output lines to display
 */
export function render(state, output = []) {
  const { cols, rows } = getTermSize();
  let screen = '';
  
  // Clear and position
  screen += clearScreen();
  
  // Output area (rows 1 to rows-2)
  const outputRows = rows - 2;
  const displayOutput = output.slice(-outputRows);
  
  for (let i = 0; i < displayOutput.length; i++) {
    screen += moveTo(i + 1, 1) + displayOutput[i];
  }
  
  // Variable line (if in INPUT mode)
  if (state.mode === 'INPUT') {
    const varLine = renderVariableLine(state.inputVar);
    screen += moveTo(rows - 1, 1) + clearLine() + varLine;
  }
  
  // Statusbar (last row)
  const statusbar = renderStatusbar(state);
  screen += moveTo(rows, 1) + clearLine() + statusbar;
  
  // Hide cursor during render
  screen = hideCursor() + screen + showCursor();
  
  process.stdout.write(screen);
}
