/**
 * REPL main loop
 * Handles input, modes, and command execution
 */

import { InputHandler, KEY } from './input.js';
import { ModeStateMachine, MODE } from './modes.js';
import { render, initTerminal, resetTerminal, printOutput, clearScreen, showCursor } from './statusbar.js';
import { JogWheelHandler } from './jog.js';
import { store } from '../commands/store.js';
import { executeCommand, executeTemplate, isCommandKey, getCommandTemplate } from '../commands/executor.js';
import { parseValue, incrementValue, decrementValue, formatValue } from '../config/variables.js';
import { persistVariableValues, loadActivities } from '../config/loader.js';

/**
 * REPL class
 */
export class Repl {
  constructor() {
    this.input = new InputHandler();
    this.mode = new ModeStateMachine();
    this.jog = new JogWheelHandler();
    this.running = false;
    this.inlineBuffer = ''; // Full inline composition buffer
    this.inputValue = ''; // Current value being typed for a variable
    this.originalValues = null; // Snapshot of values when entering VAR EDIT mode
  }
  
  /**
   * Start the REPL
   */
  async start() {
    this.running = true;
    
    // Set up input handlers
    this.input.onKey(this._handleKey.bind(this));
    this.input.start();
    
    // Initialize terminal with scroll region
    initTerminal(this._getState());
    
    // Try to start jog wheel in background (don't block)
    this.jog.start().then(() => {
      this.jog.onJog(this._handleJog.bind(this));
    });
    
    // Keep running
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }
  
  /**
   * Stop the REPL
   */
  async stop() {
    this.running = false;
    this.input.stop();
    await this.jog.stop();
    resetTerminal();
    process.stdout.write(clearScreen() + showCursor());
    if (this._resolve) {
      this._resolve();
    }
  }
  
  /**
   * Handle key press
   * @private
   */
  async _handleKey(key) {
    if (!this.running) return;
    
    // Global: Ctrl+C / Ctrl+D to exit
    if (key.type === 'ctrl' && (key.key === 'c' || key.key === 'd')) {
      this.stop();
      return;
    }
    
    // Global: Ctrl+L to clear screen/scrollback
    if (key.type === 'ctrl' && key.key === 'l') {
      this._clearScreen();
      return;
    }
    
    // Handle based on mode
    switch (this.mode.getMode()) {
      case MODE.NORMAL:
        await this._handleNormalMode(key);
        break;
      case MODE.CMD:
        await this._handleCmdMode(key);
        break;
      case MODE.INPUT:
        await this._handleInputMode(key);
        break;
      case MODE.AGENT:
        await this._handleAgentMode(key);
        break;
    }
    
    this._render();
  }
  
  /**
   * Handle NORMAL mode input
   * @private
   */
  async _handleNormalMode(key) {
    // Escape - stay in normal
    if (key.type === 'special' && key.key === 'escape') {
      this.inlineBuffer = '';
      return;
    }
    
    // Tab - switch activity
    if (key.type === 'special' && key.key === 'tab') {
      const next = store.getNextActivity();
      if (next) {
        store.setCurrentActivity(next);
        // this._addOutput(`Switched to: ${next}`);
      }
      return;
    }
    
    // Shift-Tab - previous activity
    if (key.type === 'special' && key.key === 'shift-tab') {
      const prev = store.getPrevActivity();
      if (prev) {
        store.setCurrentActivity(prev);
        // this._addOutput(`Switched to: ${prev}`);
      }
      return;
    }
    
    // : - enter CMD mode
    if (key.type === 'char' && key.key === ':') {
      this.mode.toCmd();
      return;
    }
    
    // A - enter AGENT mode (disabled for now)
    // if (key.type === 'char' && key.key === 'A') {
    //   this.mode.toAgent();
    //   return;
    // }
    
    // ? - show available commands
    if (key.type === 'char' && key.key === '?') {
      this._showHelp();
      return;
    }
    
    // $ - enter VAR EDIT mode for first variable
    if (key.type === 'char' && key.key === '$') {
      const firstVar = store.getFirstVariable();
      if (firstVar) {
        this._enterVarEditMode(firstVar.name);
      }
      return;
    }
    
    // Check for variable hotkey
    if (key.type === 'char') {
      const varInfo = store.findByHotkey(key.key);
      if (varInfo) {
        // When entering via hotkey, start with blank input for faster editing
        this._enterVarEditMode(varInfo.name, { blank: true });
        return;
      }
      
      // Check for command key
      if (isCommandKey(key.key)) {
        await this._executeCurrentCommand(key.key);
        return;
      }
      
      // Start building a command buffer
      this.inlineBuffer += key.key;
      this.mode.appendBuffer(key.key);
      
      // Check if buffer matches command
      if (isCommandKey(this.inlineBuffer)) {
        // Need Enter to execute for multi-char commands
      }
    }
    
    // Enter - execute buffer as command
    if (key.type === 'special' && key.key === 'enter') {
      const buffer = this.mode.getBuffer();
      if (buffer) {
        await this._executeBufferCommand(buffer);
      }
      this.mode.toNormal();
      this.inlineBuffer = '';
    }
    
    // Backspace
    if (key.type === 'special' && key.key === 'backspace') {
      this.mode.backspaceBuffer();
      this.inlineBuffer = this.inlineBuffer.slice(0, -1);
    }
  }
  
  /**
   * Handle CMD mode input (: commands)
   * @private
   */
  async _handleCmdMode(key) {
    // Escape - back to normal
    if (key.type === 'special' && key.key === 'escape') {
      this.mode.toNormal();
      return;
    }
    
    // Enter - execute command
    if (key.type === 'special' && key.key === 'enter') {
      await this._executeCmdCommand(this.mode.getBuffer());
      this.mode.toNormal();
      return;
    }
    
    // Backspace
    if (key.type === 'special' && key.key === 'backspace') {
      this.mode.backspaceBuffer();
      return;
    }
    
    // Regular character
    if (key.type === 'char') {
      this.mode.appendBuffer(key.key);
    }
  }
  
  /**
   * Handle INPUT mode (variable editing)
   * @private
   */
  async _handleInputMode(key) {
    const varName = this.mode.getInputVar();
    const def = store.getDefinition(varName);
    
    // Escape - discard changes and return to normal
    if (key.type === 'special' && key.key === 'escape') {
      // Revert to original values
      if (this.originalValues) {
        store.restoreValues(this.originalValues);
      }
      this.originalValues = null;
      this.mode.toNormal();
      this.inlineBuffer = '';
      this.inputValue = '';
      return;
    }
    
    // Enter - apply changes, persist to disk, and exit VAR EDIT mode
    if (key.type === 'special' && key.key === 'enter') {
      // Persist current values to YAML file
      const activityData = store.getCurrentActivity();
      if (activityData && activityData.activity) {
        // Sync current store values to activity object
        activityData.activity._values = { ...activityData.values };
        try {
          await persistVariableValues(activityData.activity);
        } catch (err) {
          this._addOutput(`Error saving: ${err.message}`);
        }
      }
      
      this.originalValues = null;
      this.mode.toNormal();
      this.inlineBuffer = '';
      this.inputValue = '';
      return;
    }
    
    // Arrow keys for navigation and inc/dec
    if (key.type === 'arrow') {
      if (key.key === 'up') {
        // Up arrow - increment value
        const current = store.get(varName);
        const newVal = incrementValue(current, def);
        store.set(varName, newVal);
        this._updateInputBufferFromVar(varName, def);
        return;
      }
      if (key.key === 'down') {
        // Down arrow - decrement value
        const current = store.get(varName);
        const newVal = decrementValue(current, def);
        store.set(varName, newVal);
        this._updateInputBufferFromVar(varName, def);
        return;
      }
      if (key.key === 'left') {
        // Left arrow - select previous variable
        const prevVar = store.getPrevVariable(varName);
        if (prevVar) {
          this._selectVar(prevVar.name);
        }
        return;
      }
      if (key.key === 'right') {
        // Right arrow - select next variable
        const nextVar = store.getNextVariable(varName);
        if (nextVar) {
          this._selectVar(nextVar.name);
        }
        return;
      }
    }
    
    // Backspace - remove last char and update var in real-time
    if (key.type === 'special' && key.key === 'backspace') {
      if (this.inputValue.length > 0) {
        this.inputValue = this.inputValue.slice(0, -1);
        this.inlineBuffer = this.inputValue;
        // Update var in real-time
        this._applyInputValue(varName, def);
      }
      return;
    }
    
    // Regular character - add to input value and update var in real-time
    // Note: Variable hotkeys are intentionally NOT checked here.
    // In VAR EDIT mode, all character input goes to the input buffer.
    // Hotkeys to switch variables only work from NORMAL mode.
    if (key.type === 'char') {
      this.inputValue += key.key;
      this.inlineBuffer = this.inputValue;
      this._applyInputValue(varName, def);
    }
  }
  
  /**
   * Enter VAR EDIT mode for a variable
   * @param {string} varName - Variable name
   * @param {object} options - Options { blank: boolean }
   * @private
   */
  _enterVarEditMode(varName, options = {}) {
    // Save original values for reverting on ESC
    if (!this.originalValues) {
      this.originalValues = store.snapshotValues();
    }
    this.mode.toInput(varName);
    if (options.blank) {
      // Start with blank input for faster editing
      this.inputValue = '';
      this.inlineBuffer = '';
    } else {
      this._updateInputBufferFromVar(varName, store.getDefinition(varName));
    }
  }
  
  /**
  /**
   * Select a variable in VAR EDIT mode
   * @param {string} varName - Variable name to select
   * @param {object} options - Options { blank: boolean }
   * @private
   */
  _selectVar(varName, options = {}) {
    this.mode.toInput(varName);
    if (options.blank) {
      // Start with blank input for faster editing
      this.inputValue = '';
      this.inlineBuffer = '';
    } else {
      this._updateInputBufferFromVar(varName, store.getDefinition(varName));
    }
  }
  
  /**
   * Update input buffer to show current var value
   * @private
   */
  _updateInputBufferFromVar(varName, def) {
    const value = store.get(varName);
    const formatted = formatValue(value, def);
    this.inputValue = formatted;
    this.inlineBuffer = formatted;
  }
  
  /**
   * Apply input value to variable in real-time
   * @private
   */
  _applyInputValue(varName, def) {
    if (this.inputValue === '') {
      // Empty input - don't update var
      return;
    }
    const parsed = parseValue(this.inputValue, def);
    if (parsed !== null) {
      store.set(varName, parsed);
    }
  }
  
  /**
   * Handle AGENT mode input
   * @private
   */
  async _handleAgentMode(key) {
    // Escape - back to normal
    if (key.type === 'special' && key.key === 'escape') {
      this.mode.toNormal();
      return;
    }
    
    // For now, just show placeholder
    this._addOutput('AGENT mode: Not yet implemented');
    this.mode.toNormal();
  }
  
  /**
   * Commit input value to variable
   * @private
   */
  _commitInputValue(varName, def) {
    if (!this.inputValue) return;
    
    const parsed = parseValue(this.inputValue, def);
    if (parsed !== null) {
      store.set(varName, parsed);
    }
  }
  
  /**
   * Execute command with current variables
   * @private
   */
  async _executeCurrentCommand(key) {
    const template = getCommandTemplate(key);
    if (!template) return;
    
    // Extract $INPUT portion from template
    const needsInput = template.includes('$INPUT');
    const input = needsInput ? this._extractInput() : '';
    
    this._addOutput(`$ ${this._getExpandedCommand(template, input)}`);
    
    // Pause stdin to allow child process to receive input
    process.stdin.pause();
    
    try {
      const result = await executeCommand(key, input, {
        onStdout: (data) => this._addOutput(data.trim()),
        onStderr: (data) => this._addOutput(data.trim())
      });
    } finally {
      // Resume stdin for REPL input
      process.stdin.resume();
    }
    
    this._addOutput(''); // Visual break after command
  }
  
  /**
   * Execute buffer as command
   * @private
   */
  async _executeBufferCommand(buffer) {
    // Try to find matching command
    for (let len = buffer.length; len > 0; len--) {
      const prefix = buffer.slice(0, len);
      if (isCommandKey(prefix)) {
        const input = buffer.slice(len);
        const template = getCommandTemplate(prefix);
        
        this._addOutput(`$ ${this._getExpandedCommand(template, input)}`);
        
        // Pause stdin to allow child process to receive input
        process.stdin.pause();
        
        try {
          await executeCommand(prefix, input, {
            onStdout: (data) => this._addOutput(data.trim()),
            onStderr: (data) => this._addOutput(data.trim())
          });
        } finally {
          // Resume stdin for REPL input
          process.stdin.resume();
        }
        
        this._addOutput(''); // Visual break after command
        return;
      }
    }
    
    this._addOutput(`Unknown command: ${buffer}`);
  }
  
  /**
   * Execute CMD mode command
   * @private
   */
  async _executeCmdCommand(cmd) {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);
    
    switch (command) {
      case 'q':
      case 'quit':
        this.stop();
        break;
        
      case 'set':
        if (args.length >= 2) {
          const varName = args[0];
          const value = args.slice(1).join(' ');
          const def = store.getDefinition(varName);
          if (def) {
            const parsed = parseValue(value, def);
            if (parsed !== null) {
              store.set(varName, parsed);
              this._addOutput(`${varName}=${formatValue(parsed, def)}`);
            } else {
              this._addOutput(`Invalid value for ${varName}`);
            }
          } else {
            this._addOutput(`Unknown variable: ${varName}`);
          }
        }
        break;
        
      case 'unset':
        if (args[0]) {
          if (store.reset(args[0])) {
            this._addOutput(`${args[0]} reset to default`);
          } else {
            this._addOutput(`Unknown variable: ${args[0]}`);
          }
        }
        break;
        
      case 'vars':
        const display = store.getFormattedDisplay();
        for (const item of display) {
          this._addOutput(item);
        }
        break;
        
      case 'reload':
        await this._reloadActivities();
        break;
        
      case 'help':
        this._addOutput(':set VAR VALUE  - Set variable');
        this._addOutput(':unset VAR      - Reset variable');
        this._addOutput(':vars           - List variables');
        this._addOutput(':reload         - Reload activities');
        this._addOutput(':q / :quit      - Exit');
        break;
        
      default:
        if (command) {
          this._addOutput(`Unknown command: ${command}`);
        }
    }
  }
  
  /**
   * Get expanded command string
   * @private
   */
  _getExpandedCommand(template, input = '') {
    const values = store.getAll();
    const definitions = store.getAllDefinitions();
    
    const formatted = {};
    for (const [name, value] of Object.entries(values)) {
      const def = definitions[name];
      formatted[name] = def ? formatValue(value, def) : String(value);
    }
    
    let result = template;
    result = result.replace(/\$INPUT\b/g, input);
    result = result.replace(/\$\{INPUT\}/g, input);
    
    for (const [name, value] of Object.entries(formatted)) {
      result = result.replace(new RegExp(`\\$\\{${name}\\}`, 'g'), value);
      result = result.replace(new RegExp(`\\$${name}\\b`, 'g'), value);
    }
    
    return result;
  }
  
  /**
   * Extract input from inline buffer
   * @private
   */
  _extractInput() {
    // For now, return empty - input handling can be enhanced
    return '';
  }
  
  /**
   * Handle jog wheel event
   * @private
   */
  _handleJog(direction) {
    if (this.mode.getMode() !== MODE.INPUT) return;
    
    const varName = this.mode.getInputVar();
    const def = store.getDefinition(varName);
    if (!def) return;
    
    const current = store.get(varName);
    const newVal = direction === 'CW' 
      ? incrementValue(current, def)
      : decrementValue(current, def);
    
    store.set(varName, newVal);
    this._updateInputBufferFromVar(varName, def);
    this._render();
  }
  
  /**
   * Get current state object
   * @private
   */
  _getState() {
    return {
      mode: this.mode.getMode(),
      buffer: this.inlineBuffer || this.mode.getBuffer(),
      inputVar: this.mode.getInputVar()
    };
  }
  
  /**
   * Add output line - prints to terminal and refreshes status bar
   * @private
   */
  _addOutput(line) {
    printOutput(line, this._getState());
  }
  
  /**
   * Reload activities from disk
   * @private
   */
  async _reloadActivities() {
    const currentActivityName = store.getCurrentActivityName();
    
    // Clear the store
    store.clear();
    
    // Reload activities from disk
    const activities = await loadActivities();
    
    if (activities.length === 0) {
      this._addOutput('No activities found after reload');
      return;
    }
    
    // Re-register all activities
    for (const activity of activities) {
      store.registerActivity(activity);
    }
    
    // Try to restore the previous activity, or fall back to first
    if (currentActivityName && store.setCurrentActivity(currentActivityName)) {
      this._addOutput(`Reloaded ${activities.length} activities (current: ${currentActivityName})`);
    } else {
      store.setCurrentActivity(activities[0].name);
      this._addOutput(`Reloaded ${activities.length} activities (switched to: ${activities[0].name})`);
    }
  }
  
  /**
   * Clear screen and scrollback buffer
   * @private
   */
  _clearScreen() {
    // Clear scrollback: ESC[3J clears scrollback, ESC[2J clears screen, ESC[H moves to home
    process.stdout.write('\x1b[3J\x1b[2J\x1b[H');
    // Re-initialize terminal with scroll region
    initTerminal(this._getState());
  }
  
  /**
   * Show help - display available commands
   * @private
   */
  _showHelp() {
    const activityData = store.getCurrentActivity();
    if (!activityData || !activityData.activity) return;
    
    const { commands, aliases } = activityData.activity;
    
    this._addOutput('');
    this._addOutput('Commands:');
    
    if (commands) {
      for (const [key, cmd] of Object.entries(commands)) {
        this._addOutput(`  ${key}  ${cmd}`);
      }
    }
    
    if (aliases && Object.keys(aliases).length > 0) {
      this._addOutput('');
      this._addOutput('Aliases:');
      for (const [alias, target] of Object.entries(aliases)) {
        this._addOutput(`  ${alias} -> ${target}`);
      }
    }
    
    this._addOutput('');
  }

  /**
   * Render the screen
   * @private
   */
  _render() {
    render(this._getState());
  }
}
