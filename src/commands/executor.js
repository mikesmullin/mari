/**
 * Shell command executor
 * Runs commands with variable substitution
 */

import { spawn, spawnSync } from 'child_process';
import { writeFile } from 'fs/promises';
import { substitute } from '../utils/template.js';
import { formatValue } from '../config/variables.js';
import { store } from './store.js';
import { appendToBuffer, getBufferPath, constructLLMBuffer } from '../config/loader.js';
import { registerChildProcess, unregisterChildProcess } from './signal.js';

/**
 * Execute a shell command with full stdio forwarding
 * Allows interactive commands that need user input
 * @param {string} command - Command string to execute
 * @param {object} options - Execution options
 * @returns {Promise<{code: number}>}
 */
export async function execute(command, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn('sh', ['-c', command], {
      stdio: 'inherit', // Forward all stdio to parent
      env: { ...process.env, ...options.env }
    });
    
    proc.on('close', (code) => {
      resolve({ code: code || 0 });
    });
    
    proc.on('error', (err) => {
      console.error('Error:', err.message);
      resolve({ code: 1 });
    });
  });
}

/**
 * Execute a shell command and capture output (non-interactive)
 * Also appends output to buffer.log for LLM context
 * @param {string} command - Command string to execute
 * @param {object} options - Execution options
 * @param {boolean} options.inheritStdin - Whether to inherit stdin (default: false for non-interactive commands)
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function executeCapture(command, options = {}) {
  // By default, don't inherit stdin for non-interactive commands
  // This allows Ctrl+C to be handled by the REPL rather than going to the child
  const stdinMode = options.inheritStdin ? 'inherit' : 'pipe';
  
  return new Promise((resolve) => {
    const proc = spawn('sh', ['-c', command], {
      stdio: [stdinMode, 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...options.env
      },
      // Create a new process group so we can kill all child processes (including pipelines)
      detached: true
    });
    
    // Close stdin immediately if we're using pipe mode (child doesn't need input)
    if (stdinMode === 'pipe' && proc.stdin) {
      proc.stdin.end();
    }
    
    // Register child process for signal handling (Ctrl+C escalation)
    registerChildProcess(proc, options.onParentExit);
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      // Append to buffer.log
      appendToBuffer(text);
      if (options.onStdout) {
        options.onStdout(text);
      }
    });
    
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      // Append to buffer.log
      appendToBuffer(text);
      if (options.onStderr) {
        options.onStderr(text);
      }
    });
    
    proc.on('close', (code) => {
      // Unregister child process and reset interrupt counter
      unregisterChildProcess();
      resolve({ code: code || 0, stdout, stderr });
    });
    
    proc.on('error', (err) => {
      // Unregister child process on error too
      unregisterChildProcess();
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

/**
 * Execute a command template with variable substitution
 * @param {string} template - Command template with $VAR placeholders
 * @param {string} input - Optional $INPUT value
 * @param {object} options - Execution options
 * @returns {Promise<{code: number, command: string}>}
 */
export async function executeTemplate(template, input = '', options = {}) {
  // Get all variable values
  const values = store.getAll();
  const definitions = store.getAllDefinitions();
  
  // Format values for command substitution
  const formatted = {};
  for (const [name, value] of Object.entries(values)) {
    const def = definitions[name];
    formatted[name] = def ? formatValue(value, def) : String(value);
  }
  
  // Substitute variables
  const command = substitute(template, formatted, input);
  
  // Execute and capture output
  const result = await executeCapture(command, options);
  return { ...result, command };
}

/**
 * Execute a command by its key from current activity
 * @param {string} key - Command key
 * @param {string} input - Optional input value
 * @param {object} options - Execution options
 * @returns {Promise<{code: number, stdout: string, stderr: string, command: string}|null>}
 */
export async function executeCommand(key, input = '', options = {}) {
  const activityData = store.getCurrentActivity();
  if (!activityData) return null;
  
  const commands = activityData.activity.commands || {};
  const cmdDef = commands[key];
  
  if (!cmdDef) return null;
  
  // Get the template - commands can be string or object with shell property
  const template = typeof cmdDef === 'string' ? cmdDef : cmdDef.shell;
  if (!template) return null;
  
  // Merge activity env vars with options.env
  const activityEnv = activityData.activity.env || {};
  const mergedOptions = {
    ...options,
    env: { ...activityEnv, ...options.env }
  };
  
  return executeTemplate(template, input, mergedOptions);
}

/**
 * Get command template by key
 * @param {string} key - Command key
 * @returns {string|null} Command template
 */
export function getCommandTemplate(key) {
  const activityData = store.getCurrentActivity();
  if (!activityData) return null;
  
  const commands = activityData.activity.commands || {};
  const cmdDef = commands[key];
  
  if (!cmdDef) return null;
  
  // Commands can be string or object with shell property
  return typeof cmdDef === 'string' ? cmdDef : cmdDef.shell || null;
}

/**
 * Get command definition by key (for accessing llm_prepend etc.)
 * @param {string} key - Command key
 * @returns {object|null} Command definition object or null
 */
export function getCommandDefinition(key) {
  const activityData = store.getCurrentActivity();
  if (!activityData) return null;
  
  const commands = activityData.activity.commands || {};
  const cmdDef = commands[key];
  
  if (!cmdDef) return null;
  
  // Normalize to object format
  if (typeof cmdDef === 'string') {
    return { shell: cmdDef };
  }
  return cmdDef;
}

/**
 * Get all command keys for current activity
 * @returns {string[]} Command keys
 */
export function getCommandKeys() {
  const activityData = store.getCurrentActivity();
  if (!activityData) return [];
  
  return Object.keys(activityData.activity.commands || {});
}

/**
 * Check if a key is a command key
 * @param {string} key - Key to check
 * @returns {boolean} True if key is a command
 */
export function isCommandKey(key) {
  return getCommandTemplate(key) !== null;
}

/**
 * Execute an LLM shell command with user input substitution
 * Reconstructs buffer.log with activity context (llm_context, skills, etc.)
 * Replaces $* with user input, $_BUFFER with buffer.log path, and $_AGENT with agent name
 * 
 * @param {string} template - LLM shell command template from config.yml
 * @param {string} userInput - User's input string
 * @param {string} agent - Agent name (from @agent prefix or default)
 * @param {object} options - Execution options
 * @param {string} options.lastCommandKey - Last executed command key (for per-command llm_prepend)
 * @returns {Promise<{code: number, stdout: string, stderr: string, command: string}>}
 */
export async function executeLlmShell(template, userInput, agent, options = {}) {
  // Get buffer path
  const bufferPath = getBufferPath();
  
  // Reconstruct buffer.log with activity context
  // This replaces the raw screen content with the expanded llm_context
  const lastCommandKey = options.lastCommandKey || null;
  const contextContent = constructLLMBuffer(userInput, lastCommandKey);
  
  // Write the constructed context to buffer.log
  await writeFile(bufferPath, contextContent, 'utf8');
  
  // Substitute $_BUFFER, $_AGENT, and $* in the template
  let command = template;
  command = command.replace(/\$_BUFFER\b/g, bufferPath);
  command = command.replace(/\$\{_BUFFER\}/g, bufferPath);
  command = command.replace(/\$_AGENT\b/g, agent);
  command = command.replace(/\$\{_AGENT\}/g, agent);
  command = command.replace(/\$\*/g, userInput);
  
  // Execute and capture output
  const result = await executeCapture(command, options);
  return { ...result, command };
}

/**
 * Execute a raw shell command (for SHELL mode)
 * @param {string} command - Raw shell command
 * @param {object} options - Execution options
 * @returns {Promise<{code: number, stdout: string, stderr: string, command: string}>}
 */
export async function executeShellDirect(command, options = {}) {
  const result = await executeCapture(command, options);
  return { ...result, command };
}
