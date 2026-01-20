/**
 * REPL main loop
 * Handles input, modes, and command execution
 */

import { InputHandler, KEY } from './input.js';
import { ModeStateMachine, MODE } from './modes.js';
import { HistoryManager } from './history.js';
import { render, initTerminal, resetTerminal, printOutput, clearScreen, showCursor, startSpinner, stopSpinner, showFlashMessage, setFlashTiming, eraseLines } from './statusbar.js';
import { JogWheelHandler } from './jog.js';
import { store } from '../commands/store.js';
import { executeCommand, executeTemplate, isCommandKey, getCommandTemplate, executeLlmShell, executeShellDirect } from '../commands/executor.js';
import { parseValue, incrementValue, decrementValue, formatValue } from '../config/variables.js';
import { persistVariableValues, loadActivities, initBuffer, clearBuffer, closeBuffer, getLlmShellCommand, getDefaultAgent, getFlashMsPerChar, startRound, endRound, undoLastRound, getRoundCount, addLinesToCurrentRound } from '../config/loader.js';
import { handleInterrupt } from '../commands/signal.js';
import { VoiceListener } from './voice.js';

/**
 * REPL class
 */
export class Repl {
  constructor() {
    this.input = new InputHandler();
    this.mode = new ModeStateMachine();
    this.jog = new JogWheelHandler();
    this.history = new HistoryManager();
    this.voice = new VoiceListener();
    this.running = false;
    this.inlineBuffer = ''; // Full inline composition buffer
    this.inputValue = ''; // Current value being typed for a variable
    this.originalValues = null; // Snapshot of values when entering VAR EDIT mode
    this.awaitingCtrlXCombo = false; // Flag for Ctrl+X prefix detection
    this.currentAgent = null; // Current agent override (persists until changed or process exits)
    this.lastCommandKey = null; // Last executed command key (for per-command llm_prepend)
    this.exitPressCount = 0; // Counter for Ctrl+C presses when no child process
    this.historyLoadedActivities = new Set(); // Track which activities have had history loaded
  }
  
  /**
   * Start the REPL
   */
  async start() {
    this.running = true;
    
    // Initialize buffer.log for scrollback capture
    await initBuffer();
    
    // Initialize flash message timing from config
    const flashMsPerChar = await getFlashMsPerChar();
    setFlashTiming(flashMsPerChar);
    
    // Load history from current activity
    this._loadHistoryFromActivity();
    
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
    closeBuffer();
    resetTerminal();
    process.stdout.write(clearScreen() + showCursor());
    if (this._resolve) {
      this._resolve();
    }
  }
  
  /**
   * Emergency cleanup before forced exit (called on 3rd Ctrl+C)
   * Does minimal synchronous cleanup to restore terminal state
   * @private
   */
  _emergencyCleanup() {
    try {
      stopSpinner();
      resetTerminal();
      process.stdout.write(showCursor());
    } catch (e) {
      // Ignore errors during emergency cleanup
    }
  }
  
  /**
   * Handle key press
   * @private
   */
  async _handleKey(key) {
    if (!this.running) return;
    
    // Reset exit confirmation counter on any key except Ctrl+C
    if (!(key.type === 'ctrl' && key.key === 'c')) {
      this.exitPressCount = 0;
    }
    
    // Global: Handle Ctrl+X combo system
    // Ctrl+X is a prefix for global hotkey combos that work in all modes
    if (this.awaitingCtrlXCombo) {
      this.awaitingCtrlXCombo = false;
      // Handle Ctrl+X, <key> combos
      if (key.type === 'char') {
        const handled = await this._handleCtrlXCombo(key.key);
        if (handled) {
          this._render();
          return;
        }
      }
      // If no valid combo, ignore the second key
      this._render();
      return;
    }
    
    // Global: Ctrl+X - start combo sequence
    if (key.type === 'ctrl' && key.key === 'x') {
      this.awaitingCtrlXCombo = true;
      return;
    }
    
    // Global: Ctrl+C - check if child process is running first
    if (key.type === 'ctrl' && key.key === 'c') {
      // handleInterrupt returns true if a child process was running and it handled the signal
      if (!handleInterrupt()) {
        // No child process - require confirmation to exit
        this.exitPressCount++;
        if (this.exitPressCount >= 2) {
          this.stop();
        } else {
          showFlashMessage('Press Ctrl+C again to exit', () => this._render());
          // Reset counter after 1 seconds if no second press
          clearTimeout(this._exitTimeout);
          this._exitTimeout = setTimeout(() => {
            this.exitPressCount = 0;
          }, 1000);
        }
      }
      return;
    }
    
    // Global: Ctrl+D to exit
    if (key.type === 'ctrl' && key.key === 'd') {
      this.stop();
      return;
    }
    
    // Global: Ctrl+L to clear screen/scrollback
    if (key.type === 'ctrl' && key.key === 'l') {
      await this._clearScreen();
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
      case MODE.LLM:
        await this._handleLlmMode(key);
        break;
      case MODE.SHELL:
        await this._handleShellMode(key);
        break;
      case MODE.WORD:
        await this._handleWordMode(key);
        break;
      case MODE.VOICE:
        await this._handleVoiceMode(key);
        break;
    }
    
    this._render();
  }
  
  /**
   * Handle Ctrl+X combo hotkeys (global, works in all modes)
   * @param {string} key - The key pressed after Ctrl+X
   * @returns {boolean} True if combo was handled
   * @private
   */
  async _handleCtrlXCombo(key) {
    switch (key) {
      case 'u':
        // Ctrl+X, u: Undo last round
        await this._undoLastRound();
        return true;
      default:
        return false;
    }
  }
  
  /**
   * Undo the last execution round
   * Removes it from memory and rewrites buffer.log
   * @private
   */
  async _undoLastRound() {
    const count = getRoundCount();
    if (count === 0) {
      // Show flash message for no rounds
      showFlashMessage('No rounds to undo', () => this._render());
      return;
    }
    
    const result = await undoLastRound();
    if (result) {
      const { round, linesToErase } = result;
      
      // Erase the cumulative lines from the screen
      eraseLines(linesToErase, this._getState());
      
      // Show flash message with undo confirmation
      const cmd = round.command || '(empty)';
      // Truncate command if too long
      const displayCmd = cmd.length > 40 ? cmd.slice(0, 37) + '...' : cmd;
      showFlashMessage(`Undid: ${displayCmd}`, () => this._render());
    }
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
        this._loadHistoryFromActivity();
        // this._addOutput(`Switched to: ${next}`);
      }
      return;
    }
    
    // Shift-Tab - previous activity
    if (key.type === 'special' && key.key === 'shift-tab') {
      const prev = store.getPrevActivity();
      if (prev) {
        store.setCurrentActivity(prev);
        this._loadHistoryFromActivity();
        // this._addOutput(`Switched to: ${prev}`);
      }
      return;
    }
    
    // : - enter CMD mode
    if (key.type === 'char' && key.key === ':') {
      this.mode.toCmd();
      return;
    }
    
    // @ - enter LLM mode
    if (key.type === 'char' && key.key === '@') {
      this.mode.toLlm();
      return;
    }
    
    // ! - enter SHELL mode
    if (key.type === 'char' && key.key === '!') {
      this.mode.toShell();
      return;
    }
    
    // % - enter WORD mode
    if (key.type === 'char' && key.key === '%') {
      this.mode.toWord();
      return;
    }
    
    // # - enter VOICE mode
    if (key.type === 'char' && key.key === '#') {
      await this._enterVoiceMode();
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
      this.history.resetNavigation('CMD');
      this.mode.toNormal();
      return;
    }
    
    // Enter - execute command
    if (key.type === 'special' && key.key === 'enter') {
      const buffer = this.mode.getBuffer();
      if (buffer) {
        this.history.add('CMD', buffer);
      }
      this.history.resetNavigation('CMD');
      await this._executeCmdCommand(buffer);
      this.mode.toNormal();
      return;
    }
    
    // Arrow up - navigate history (older)
    if (key.type === 'arrow' && key.key === 'up') {
      const entry = this.history.navigateUp('CMD', this.mode.getBuffer());
      if (entry !== null) {
        this.mode.clearBuffer();
        for (const ch of entry) {
          this.mode.appendBuffer(ch);
        }
      }
      return;
    }
    
    // Arrow down - navigate history (newer)
    if (key.type === 'arrow' && key.key === 'down') {
      const entry = this.history.navigateDown('CMD');
      if (entry !== null) {
        this.mode.clearBuffer();
        for (const ch of entry) {
          this.mode.appendBuffer(ch);
        }
      }
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
    // Input buffer should be empty for undefined values (not show "(undefined)")
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
      // Empty input - set variable to undefined
      store.set(varName, undefined);
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
   * Handle LLM mode input
   * Single-line input, Enter submits to LLM shell command from config.yml
   * Stays in LLM mode until ESC is pressed
   * @private
   */
  async _handleLlmMode(key) {
    // Escape - back to normal
    if (key.type === 'special' && key.key === 'escape') {
      this.history.resetNavigation('LLM');
      this.mode.toNormal();
      this.inlineBuffer = '';
      return;
    }
    
    // Enter - execute LLM shell command, stay in LLM mode
    if (key.type === 'special' && key.key === 'enter') {
      const userInput = this.mode.getBuffer();
      if (userInput) {
        // Add to history before execution
        this.history.add('LLM', userInput);
        this.history.resetNavigation('LLM');
        
        const llmShell = await getLlmShellCommand();
        if (llmShell) {
          // Parse @agent prefix if present (allows letters, numbers, hyphens, underscores)
          let prompt = userInput;
          const agentMatch = userInput.match(/^@([\w-]+)(?:\s+|$)/);
          if (agentMatch) {
            // Update current agent (persists for future inputs)
            this.currentAgent = agentMatch[1];
            prompt = userInput.slice(agentMatch[0].length).trim();
          }
          
          // If input was only an @agent mention with no prompt, just set the agent and show flash
          if (!prompt) {
            this.mode.clearBuffer();
            this.inlineBuffer = '';
            showFlashMessage(`Agent set to: ${this.currentAgent}`, () => this._render());
            return;
          }
          
          // Use currentAgent if set, otherwise fall back to default_agent
          const agent = this.currentAgent || await getDefaultAgent();
          
          const displayCommand = `@ ${userInput}`;
          
          // Start a new round for this execution
          startRound(displayCommand);
          
          this._addOutput(displayCommand);
          
          // Clear buffer before exec starts
          this.mode.clearBuffer();
          this.inlineBuffer = '';
          this._render();
          
          // Start spinner
          startSpinner(() => this._render());
          
          try {
            await executeLlmShell(llmShell, prompt, agent, {
              lastCommandKey: this.lastCommandKey,
              onStdout: (data) => this._addOutput(data.trim()),
              onStderr: (data) => this._addOutput(data.trim()),
              onParentExit: () => this._emergencyCleanup()
            });
          } finally {
            // Stop spinner
            stopSpinner();
            // End the round
            endRound();
          }
          
          this._addOutput(''); // Visual break after command
        } else {
          this._addOutput('Error: llm_shell not configured in config.yml');
          // Clear buffer on error too
          this.mode.clearBuffer();
          this.inlineBuffer = '';
        }
      }
      return;
    }
    
    // Arrow up - navigate history (older)
    if (key.type === 'arrow' && key.key === 'up') {
      const entry = this.history.navigateUp('LLM', this.mode.getBuffer());
      if (entry !== null) {
        this.mode.clearBuffer();
        for (const ch of entry) {
          this.mode.appendBuffer(ch);
        }
        this.inlineBuffer = this.mode.getBuffer();
      }
      return;
    }
    
    // Arrow down - navigate history (newer)
    if (key.type === 'arrow' && key.key === 'down') {
      const entry = this.history.navigateDown('LLM');
      if (entry !== null) {
        this.mode.clearBuffer();
        for (const ch of entry) {
          this.mode.appendBuffer(ch);
        }
        this.inlineBuffer = this.mode.getBuffer();
      }
      return;
    }
    
    // Backspace
    if (key.type === 'special' && key.key === 'backspace') {
      this.mode.backspaceBuffer();
      this.inlineBuffer = this.mode.getBuffer();
      return;
    }
    
    // Regular character - append to buffer
    if (key.type === 'char') {
      this.mode.appendBuffer(key.key);
      this.inlineBuffer = this.mode.getBuffer();
    }
  }
  
  /**
   * Handle SHELL mode input
   * Single-line input, Enter executes as raw shell command
   * Stays in SHELL mode until ESC is pressed
   * @private
   */
  async _handleShellMode(key) {
    // Escape - back to normal
    if (key.type === 'special' && key.key === 'escape') {
      this.history.resetNavigation('SHELL');
      this.mode.toNormal();
      this.inlineBuffer = '';
      return;
    }
    
    // Enter - execute shell command, stay in SHELL mode
    if (key.type === 'special' && key.key === 'enter') {
      const command = this.mode.getBuffer();
      if (command) {
        // Add to history before execution
        this.history.add('SHELL', command);
        this.history.resetNavigation('SHELL');
        
        const displayCommand = `! ${command}`;
        
        // Start a new round for this execution
        startRound(displayCommand);
        
        this._addOutput(displayCommand);
        
        // Clear buffer before exec starts
        this.mode.clearBuffer();
        this.inlineBuffer = '';
        this._render();
        
        // Start spinner
        startSpinner(() => this._render());
        
        try {
          await executeShellDirect(command, {
            onStdout: (data) => this._addOutput(data.trim()),
            onStderr: (data) => this._addOutput(data.trim()),
            onParentExit: () => this._emergencyCleanup()
          });
        } finally {
          // Stop spinner
          stopSpinner();
          // End the round
          endRound();
        }
        
        this._addOutput(''); // Visual break after command
      }
      return;
    }
    
    // Arrow up - navigate history (older)
    if (key.type === 'arrow' && key.key === 'up') {
      const entry = this.history.navigateUp('SHELL', this.mode.getBuffer());
      if (entry !== null) {
        this.mode.clearBuffer();
        for (const ch of entry) {
          this.mode.appendBuffer(ch);
        }
        this.inlineBuffer = this.mode.getBuffer();
      }
      return;
    }
    
    // Arrow down - navigate history (newer)
    if (key.type === 'arrow' && key.key === 'down') {
      const entry = this.history.navigateDown('SHELL');
      if (entry !== null) {
        this.mode.clearBuffer();
        for (const ch of entry) {
          this.mode.appendBuffer(ch);
        }
        this.inlineBuffer = this.mode.getBuffer();
      }
      return;
    }
    
    // Backspace
    if (key.type === 'special' && key.key === 'backspace') {
      this.mode.backspaceBuffer();
      this.inlineBuffer = this.mode.getBuffer();
      return;
    }
    
    // Regular character - append to buffer
    if (key.type === 'char') {
      this.mode.appendBuffer(key.key);
      this.inlineBuffer = this.mode.getBuffer();
    }
  }
  
  /**
   * Handle WORD mode input
   * User types a word and presses Enter to execute the matching command
   * Hotkeys are disabled in this mode
   * @private
   */
  async _handleWordMode(key) {
    // Escape - back to normal
    if (key.type === 'special' && key.key === 'escape') {
      this.history.resetNavigation('WORD');
      this.mode.toNormal();
      this.inlineBuffer = '';
      return;
    }
    
    // Enter - try to match word to a command
    if (key.type === 'special' && key.key === 'enter') {
      const word = this.mode.getBuffer().trim().toLowerCase();
      if (word) {
        // Add to history before execution
        this.history.add('WORD', word);
        this.history.resetNavigation('WORD');
        
        // Try to find matching command by word
        const match = this._findCommandByWord(word);
        
        if (match) {
          // Clear buffer before exec starts
          this.mode.clearBuffer();
          this.inlineBuffer = '';
          this._render();
          
          // Execute the matched command
          await this._executeCommandByKey(match.key);
        } else {
          showFlashMessage(`No command for word: ${word}`, () => this._render());
          this.mode.clearBuffer();
          this.inlineBuffer = '';
        }
      }
      return;
    }
    
    // Arrow up - navigate history (older)
    if (key.type === 'arrow' && key.key === 'up') {
      const entry = this.history.navigateUp('WORD', this.mode.getBuffer());
      if (entry !== null) {
        this.mode.clearBuffer();
        for (const ch of entry) {
          this.mode.appendBuffer(ch);
        }
        this.inlineBuffer = this.mode.getBuffer();
      }
      return;
    }
    
    // Arrow down - navigate history (newer)
    if (key.type === 'arrow' && key.key === 'down') {
      const entry = this.history.navigateDown('WORD');
      if (entry !== null) {
        this.mode.clearBuffer();
        for (const ch of entry) {
          this.mode.appendBuffer(ch);
        }
        this.inlineBuffer = this.mode.getBuffer();
      }
      return;
    }
    
    // Backspace
    if (key.type === 'special' && key.key === 'backspace') {
      this.mode.backspaceBuffer();
      this.inlineBuffer = this.mode.getBuffer();
      return;
    }
    
    // Regular character - append to buffer (no hotkey processing!)
    if (key.type === 'char') {
      this.mode.appendBuffer(key.key);
      this.inlineBuffer = this.mode.getBuffer();
    }
  }
  
  /**
   * Handle VOICE mode input
   * Listens for voice transcriptions and matches them against voice patterns
   * Only Escape key works to exit; keyboard is otherwise ignored
   * @private
   */
  async _handleVoiceMode(key) {
    // Escape - stop listening and return to normal
    if (key.type === 'special' && key.key === 'escape') {
      await this._exitVoiceMode();
      return;
    }
    
    // In VOICE mode, all other keys are ignored
    // Voice input is processed via the VoiceListener polling
  }
  
  /**
   * Enter VOICE mode and start listening
   * @private
   */
  async _enterVoiceMode() {
    this.mode.toVoice();
    this.inlineBuffer = '';
    
    // Set up voice handler
    this.voice.onVoice(this._handleVoiceInput.bind(this));
    
    // Start listening
    await this.voice.start();
    
    showFlashMessage('Listening...', () => this._render());
  }
  
  /**
   * Exit VOICE mode and stop listening
   * @private
   */
  async _exitVoiceMode() {
    // Stop voice listener
    this.voice.stop();
    this.voice.offVoice(this._handleVoiceInput.bind(this));
    
    this.mode.toNormal();
    this.inlineBuffer = '';
  }
  
  /**
   * Handle voice input from VoiceListener
   * @param {string} normalized - Normalized text (lowercase, alphanumeric)
   * @param {string} original - Original transcription
   * @param {string} timestamp - ISO timestamp
   * @private
   */
  async _handleVoiceInput(normalized, original, timestamp) {
    // Only process if still in VOICE mode
    if (this.mode.getMode() !== MODE.VOICE) return;
    
    // Show the transcription as a flash message
    showFlashMessage(`🎤 ${original}`, () => this._render());
    
    // Try to match against voice patterns
    const match = this._findCommandByVoice(normalized);
    
    if (match) {
      // Exit voice mode before executing
      await this._exitVoiceMode();
      
      // Execute the matched command
      await this._executeCommandByKey(match.key);
      
      this._render();
    }
  }
  
  /**
   * Find a command by its word property
   * @param {string} word - The word to match (already lowercase)
   * @returns {{key: string, cmdDef: object}|null} Matched command or null
   * @private
   */
  _findCommandByWord(word) {
    const activityData = store.getCurrentActivity();
    if (!activityData || !activityData.activity) return null;
    
    const commands = activityData.activity.commands || {};
    
    for (const [key, cmdDef] of Object.entries(commands)) {
      // Commands can be string (no word) or object with word property
      if (typeof cmdDef === 'object' && cmdDef.word) {
        if (cmdDef.word.toLowerCase() === word) {
          return { key, cmdDef };
        }
      }
    }
    
    return null;
  }
  
  /**
   * Find a command by its voice pattern (regex)
   * @param {string} text - Normalized text to match against
   * @returns {{key: string, cmdDef: object}|null} Matched command or null
   * @private
   */
  _findCommandByVoice(text) {
    const activityData = store.getCurrentActivity();
    if (!activityData || !activityData.activity) return null;
    
    const commands = activityData.activity.commands || {};
    
    for (const [key, cmdDef] of Object.entries(commands)) {
      // Commands can be object with voice property (regex pattern)
      if (typeof cmdDef === 'object' && cmdDef.voice) {
        try {
          const regex = new RegExp(cmdDef.voice, 'i');
          if (regex.test(text)) {
            return { key, cmdDef };
          }
        } catch (e) {
          // Invalid regex - skip
        }
      }
    }
    
    return null;
  }
  
  /**
   * Execute a command by its key
   * @param {string} key - Command key
   * @private
   */
  async _executeCommandByKey(key) {
    const template = getCommandTemplate(key);
    if (!template) return;
    
    // Track last executed command for per-command llm_prepend
    this.lastCommandKey = key;
    
    const expandedCommand = `$ ${this._getExpandedCommand(template, '')}`;
    
    // Start a new round for this execution
    startRound(expandedCommand);
    
    this._addOutput(expandedCommand);
    
    // Start spinner
    startSpinner(() => this._render());
    
    try {
      await executeCommand(key, '', {
        onStdout: (data) => this._addOutput(data.trim()),
        onStderr: (data) => this._addOutput(data.trim()),
        onParentExit: () => this._emergencyCleanup()
      });
    } finally {
      // Stop spinner
      stopSpinner();
      // End the round
      endRound();
    }
    
    this._addOutput(''); // Visual break after command
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
    
    // Track last executed command for per-command llm_prepend
    this.lastCommandKey = key;
    
    // Extract $INPUT portion from template
    const needsInput = template.includes('$INPUT');
    const input = needsInput ? this._extractInput() : '';
    
    const expandedCommand = `$ ${this._getExpandedCommand(template, input)}`;
    
    // Start a new round for this execution
    startRound(expandedCommand);
    
    this._addOutput(expandedCommand);
    
    // Start spinner
    startSpinner(() => this._render());
    
    try {
      const result = await executeCommand(key, input, {
        onStdout: (data) => this._addOutput(data.trim()),
        onStderr: (data) => this._addOutput(data.trim()),
        onParentExit: () => this._emergencyCleanup()
      });
    } finally {
      // Stop spinner
      stopSpinner();
      // End the round
      endRound();
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
        // Track last executed command for per-command llm_prepend
        this.lastCommandKey = prefix;
        
        const input = buffer.slice(len);
        const template = getCommandTemplate(prefix);
        
        const expandedCommand = `$ ${this._getExpandedCommand(template, input)}`;
        
        // Start a new round for this execution
        startRound(expandedCommand);
        
        this._addOutput(expandedCommand);
        
        // Start spinner
        startSpinner(() => this._render());
        
        try {
          await executeCommand(prefix, input, {
            onStdout: (data) => this._addOutput(data.trim()),
            onStderr: (data) => this._addOutput(data.trim()),
            onParentExit: () => this._emergencyCleanup()
          });
        } finally {
          // Stop spinner
          stopSpinner();
          // End the round
          endRound();
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
   * Also tracks line count for the current round (for undo)
   * @private
   */
  _addOutput(line) {
    printOutput(line, this._getState());
    // Track line count for current round (each _addOutput is one line)
    // Count actual newlines in the line plus 1 for the line itself
    const newlineCount = (line.match(/\n/g) || []).length;
    addLinesToCurrentRound(1 + newlineCount);
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
    
    // Note: History is NOT reloaded on :reload - only on process restart
  }
  
  /**
   * Clear screen and scrollback buffer
   * Also truncates buffer.log
   * @private
   */
  async _clearScreen() {
    // Clear buffer.log
    await clearBuffer();
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
    
    // Get current variable values, filtering out undefined/empty
    const values = activityData.values || {};
    const definedValues = {};
    for (const [name, val] of Object.entries(values)) {
      if (val !== undefined && val !== null && val !== '') {
        definedValues[name] = val;
      }
    }
    
    this._addOutput('');
    this._addOutput('Commands:');
    
    if (commands) {
      for (const [key, cmdDef] of Object.entries(commands)) {
        // Get the command template (string or object with shell property)
        const cmd = typeof cmdDef === 'string' ? cmdDef : cmdDef.shell;
        // Substitute defined variables, leave undefined as-is
        const expanded = this._substituteForHelp(cmd, definedValues);
        // Get optional description
        const description = typeof cmdDef === 'object' ? cmdDef.description : null;
        const descSuffix = description ? `  # ${description}` : '';
        this._addOutput(`  ${key}  ${expanded}${descSuffix}`);
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
   * Substitute variables for help display
   * Only replaces variables that have defined values
   * Supports $VAR:type:format syntax (e.g., $SINCE:date:YYYY-MM-dd)
   * @param {string} template - Command template
   * @param {object} values - Variable values (only defined ones)
   * @returns {string} Substituted string
   * @private
   */
  _substituteForHelp(template, values) {
    let result = template;
    
    // Replace $VAR:type:format syntax (e.g., $SINCE:date:YYYY-MM-dd)
    result = result.replace(/\$([A-Z_][A-Z0-9_]*):(\w+):([^\s"']+)/g, (match, name, type, format) => {
      if (!values.hasOwnProperty(name)) return match;
      return this._formatWithSpec(values[name], type, format);
    });
    
    // Replace ${VAR:type:format} syntax
    result = result.replace(/\$\{([A-Z_][A-Z0-9_]*):(\w+):([^}]+)\}/g, (match, name, type, format) => {
      if (!values.hasOwnProperty(name)) return match;
      return this._formatWithSpec(values[name], type, format);
    });
    
    // Replace ${VAR} syntax - only if value is defined
    result = result.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (match, name) => {
      return values.hasOwnProperty(name) ? String(values[name]) : match;
    });
    
    // Replace $VAR syntax (word boundary) - only if value is defined
    result = result.replace(/\$([A-Z_][A-Z0-9_]*)\b/g, (match, name) => {
      return values.hasOwnProperty(name) ? String(values[name]) : match;
    });
    
    return result;
  }
  
  /**
   * Format a value with a type and format specifier
   * @param {any} value - The value to format
   * @param {string} type - The type (e.g., 'date')
   * @param {string} format - The format string (e.g., 'YYYY-MM-dd')
   * @returns {string} Formatted value
   * @private
   */
  _formatWithSpec(value, type, format) {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    
    switch (type) {
      case 'date': {
        // Convert to Date if it's a string (e.g., ISO string)
        let date = value;
        if (typeof value === 'string') {
          date = new Date(value);
        }
        if (date instanceof Date && !isNaN(date.getTime())) {
          // Import formatDate dynamically would be complex, so inline the logic
          const year = date.getFullYear();
          const month = date.getMonth() + 1;
          const day = date.getDate();
          let result = format;
          result = result.replace(/YYYY/g, String(year));
          result = result.replace(/yyyy/g, String(year));
          result = result.replace(/yy/g, String(year % 100).padStart(2, '0'));
          result = result.replace(/MM/g, String(month).padStart(2, '0'));
          result = result.replace(/M/g, String(month));
          result = result.replace(/dd/g, String(day).padStart(2, '0'));
          result = result.replace(/d/g, String(day));
          return result;
        }
        return String(value);
      }
      default:
        return String(value);
    }
  }

  /**
   * Render the screen
   * @private
   */
  _render() {
    render(this._getState());
  }

  /**
   * Load history from current activity's history configuration
   * Only loads once per activity unless force=true (used by :reload)
   * @param {boolean} force - If true, reload even if already loaded for this activity
   * @private
   */
  _loadHistoryFromActivity(force = false) {
    const activityName = store.getCurrentActivityName();
    if (!activityName) return;

    // Skip if already loaded for this activity (unless forced)
    if (!force && this.historyLoadedActivities.has(activityName)) {
      return;
    }

    const activityData = store.getCurrentActivity();
    if (activityData && activityData.activity && activityData.activity.history) {
      this.history.loadFromActivity(activityData.activity.history);
    } else {
      // No history defined - clear all histories
      this.history.loadFromActivity(null);
    }

    // Mark this activity as having history loaded
    this.historyLoadedActivities.add(activityName);
  }

  /**
   * Reset history loaded tracking (called by :reload)
   * @private
   */
  _resetHistoryLoaded() {
    this.historyLoadedActivities.clear();
  }
}
