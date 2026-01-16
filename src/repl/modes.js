/**
 * Mode state machine for REPL
 * Modes: NORMAL, CMD, INPUT, AGENT
 */

/**
 * Mode constants
 */
export const MODE = {
  NORMAL: 'NORMAL',
  CMD: 'CMD',
  INPUT: 'INPUT',
  AGENT: 'AGENT'
};

/**
 * Mode state machine
 */
export class ModeStateMachine {
  constructor() {
    this.mode = MODE.NORMAL;
    this.buffer = '';
    this.inputVar = null; // Variable being edited in INPUT mode
    this.inputBuffer = ''; // Buffer for variable value input
    this.listeners = [];
  }
  
  /**
   * Get current mode
   * @returns {string} Current mode
   */
  getMode() {
    return this.mode;
  }
  
  /**
   * Get command buffer (for CMD mode)
   * @returns {string} Buffer content
   */
  getBuffer() {
    return this.buffer;
  }
  
  /**
   * Get input variable name (for INPUT mode)
   * @returns {string|null} Variable name
   */
  getInputVar() {
    return this.inputVar;
  }
  
  /**
   * Get input buffer (for INPUT mode)
   * @returns {string} Input buffer
   */
  getInputBuffer() {
    return this.inputBuffer;
  }
  
  /**
   * Transition to NORMAL mode
   */
  toNormal() {
    this.mode = MODE.NORMAL;
    this.buffer = '';
    this.inputVar = null;
    this.inputBuffer = '';
    this._emit('mode', MODE.NORMAL);
  }
  
  /**
   * Transition to CMD mode
   */
  toCmd() {
    this.mode = MODE.CMD;
    this.buffer = '';
    this._emit('mode', MODE.CMD);
  }
  
  /**
   * Transition to INPUT mode for a variable
   * @param {string} varName - Variable name
   */
  toInput(varName) {
    this.mode = MODE.INPUT;
    this.inputVar = varName;
    this.inputBuffer = '';
    this._emit('mode', MODE.INPUT);
  }
  
  /**
   * Transition to AGENT mode
   */
  toAgent() {
    this.mode = MODE.AGENT;
    this.buffer = '';
    this._emit('mode', MODE.AGENT);
  }
  
  /**
   * Append to buffer (CMD mode)
   * @param {string} char - Character to append
   */
  appendBuffer(char) {
    this.buffer += char;
    this._emit('buffer', this.buffer);
  }
  
  /**
   * Backspace in buffer (CMD mode)
   */
  backspaceBuffer() {
    if (this.buffer.length > 0) {
      this.buffer = this.buffer.slice(0, -1);
      this._emit('buffer', this.buffer);
    }
  }
  
  /**
   * Clear buffer (CMD mode)
   */
  clearBuffer() {
    this.buffer = '';
    this._emit('buffer', this.buffer);
  }
  
  /**
   * Append to input buffer (INPUT mode)
   * @param {string} char - Character to append
   */
  appendInput(char) {
    this.inputBuffer += char;
    this._emit('input', this.inputBuffer);
  }
  
  /**
   * Backspace in input buffer (INPUT mode)
   */
  backspaceInput() {
    if (this.inputBuffer.length > 0) {
      this.inputBuffer = this.inputBuffer.slice(0, -1);
      this._emit('input', this.inputBuffer);
    }
  }
  
  /**
   * Clear input buffer and commit value
   * @returns {{varName: string, value: string}} Committed input
   */
  commitInput() {
    const result = {
      varName: this.inputVar,
      value: this.inputBuffer
    };
    this.inputBuffer = '';
    return result;
  }
  
  /**
   * Add event listener
   * @param {function} fn - Listener (type, value)
   */
  on(fn) {
    this.listeners.push(fn);
  }
  
  /**
   * Remove event listener
   * @param {function} fn - Listener to remove
   */
  off(fn) {
    this.listeners = this.listeners.filter(l => l !== fn);
  }
  
  /**
   * Emit event
   * @private
   */
  _emit(type, value) {
    for (const fn of this.listeners) {
      fn(type, value);
    }
  }
  
  /**
   * Get full display buffer (combining mode prefix and content)
   * @returns {string} Display buffer
   */
  getDisplayBuffer() {
    switch (this.mode) {
      case MODE.CMD:
        return ':' + this.buffer;
      case MODE.INPUT:
        return this.inputVar + this.inputBuffer;
      default:
        return this.buffer;
    }
  }
}
