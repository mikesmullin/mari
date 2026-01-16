/**
 * Raw stdin input handler
 * Handles keyboard input in raw mode
 */

/**
 * Key codes and sequences
 */
export const KEY = {
  ENTER: '\r',
  NEWLINE: '\n',
  ESCAPE: '\x1b',
  BACKSPACE: '\x7f',
  DELETE: '\x1b[3~',
  TAB: '\t',
  SHIFT_TAB: '\x1b[Z',
  UP: '\x1b[A',
  DOWN: '\x1b[B',
  RIGHT: '\x1b[C',
  LEFT: '\x1b[D',
  CTRL_C: '\x03',
  CTRL_D: '\x04',
  CTRL_L: '\x0c',
};

/**
 * Parse key input into a structured object
 * @param {Buffer} data - Raw input buffer
 * @returns {object} Parsed key info
 */
export function parseKey(data) {
  const str = data.toString();
  
  // Control characters
  if (str === KEY.CTRL_C) {
    return { type: 'ctrl', key: 'c', raw: str };
  }
  if (str === KEY.CTRL_D) {
    return { type: 'ctrl', key: 'd', raw: str };
  }
  if (str === KEY.CTRL_L) {
    return { type: 'ctrl', key: 'l', raw: str };
  }
  
  // Special keys
  if (str === KEY.ENTER || str === KEY.NEWLINE) {
    return { type: 'special', key: 'enter', raw: str };
  }
  if (str === KEY.ESCAPE) {
    return { type: 'special', key: 'escape', raw: str };
  }
  if (str === KEY.BACKSPACE) {
    return { type: 'special', key: 'backspace', raw: str };
  }
  if (str === KEY.DELETE) {
    return { type: 'special', key: 'delete', raw: str };
  }
  if (str === KEY.TAB) {
    return { type: 'special', key: 'tab', raw: str };
  }
  if (str === KEY.SHIFT_TAB) {
    return { type: 'special', key: 'shift-tab', raw: str };
  }
  
  // Arrow keys
  if (str === KEY.UP) {
    return { type: 'arrow', key: 'up', raw: str };
  }
  if (str === KEY.DOWN) {
    return { type: 'arrow', key: 'down', raw: str };
  }
  if (str === KEY.LEFT) {
    return { type: 'arrow', key: 'left', raw: str };
  }
  if (str === KEY.RIGHT) {
    return { type: 'arrow', key: 'right', raw: str };
  }
  
  // Regular character
  if (str.length === 1 && str >= ' ' && str <= '~') {
    return { type: 'char', key: str, raw: str };
  }
  
  // Unknown escape sequence
  if (str.startsWith('\x1b')) {
    return { type: 'escape-seq', key: str, raw: str };
  }
  
  return { type: 'unknown', key: str, raw: str };
}

/**
 * Enable raw mode on stdin
 * @returns {function} Cleanup function
 */
export function enableRawMode() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  
  return () => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };
}

/**
 * Read a single key press
 * @returns {Promise<object>} Parsed key
 */
export function readKey() {
  return new Promise((resolve) => {
    const handler = (data) => {
      process.stdin.removeListener('data', handler);
      resolve(parseKey(Buffer.from(data)));
    };
    process.stdin.on('data', handler);
  });
}

/**
 * Input handler class for managing keyboard input
 */
export class InputHandler {
  constructor() {
    this.listeners = [];
    this.cleanup = null;
  }
  
  /**
   * Start listening for input
   */
  start() {
    this.cleanup = enableRawMode();
    process.stdin.on('data', this._handleData.bind(this));
  }
  
  /**
   * Stop listening for input
   */
  stop() {
    process.stdin.removeAllListeners('data');
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  }
  
  /**
   * Add a key listener
   * @param {function} fn - Listener function (receives parsed key)
   */
  onKey(fn) {
    this.listeners.push(fn);
  }
  
  /**
   * Remove a key listener
   * @param {function} fn - Listener to remove
   */
  offKey(fn) {
    this.listeners = this.listeners.filter(l => l !== fn);
  }
  
  /**
   * Handle raw data - process each character/sequence separately
   * @private
   */
  _handleData(data) {
    const str = data.toString();
    let i = 0;
    
    while (i < str.length) {
      let chunk;
      
      // Check for escape sequences
      if (str[i] === '\x1b') {
        // Find the end of the escape sequence
        if (str[i + 1] === '[') {
          // CSI sequence - ends with a letter
          let j = i + 2;
          while (j < str.length && str[j] >= '0' && str[j] <= '?') {
            j++;
          }
          if (j < str.length) {
            j++; // Include the final letter
          }
          chunk = str.slice(i, j);
          i = j;
        } else {
          // Just escape
          chunk = str[i];
          i++;
        }
      } else {
        // Single character
        chunk = str[i];
        i++;
      }
      
      const key = parseKey(Buffer.from(chunk));
      for (const listener of this.listeners) {
        listener(key);
      }
    }
  }
}
