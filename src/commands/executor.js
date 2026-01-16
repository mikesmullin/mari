/**
 * Shell command executor
 * Runs commands with variable substitution
 */

import { spawn, spawnSync } from 'child_process';
import { substitute } from '../utils/template.js';
import { formatValue } from '../config/variables.js';
import { store } from './store.js';

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
 * @param {string} command - Command string to execute
 * @param {object} options - Execution options
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function executeCapture(command, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn('sh', ['-c', command], {
      stdio: ['inherit', 'pipe', 'inherit'],
      env: {
        ...process.env,
        ...options.env
      }
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      if (options.onStdout) {
        options.onStdout(data.toString());
      }
    });
    
    proc.on('close', (code) => {
      resolve({ code: code || 0, stdout, stderr });
    });
    
    proc.on('error', (err) => {
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
  const template = commands[key];
  
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
  return commands[key] || null;
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
