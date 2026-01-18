/**
 * Activity file loader
 * Reads YAML activity files from ./activity/
 */

import { readdir, readFile, writeFile, mkdir, truncate, appendFile } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { parseYaml, stringifyYaml } from '../utils/yaml.js';
import { validateActivity, getDefaultActivity } from './schema.js';
import { getDefaultValue } from './variables.js';

// Re-export buffer functions from the buffer manager module
export {
  getBufferPath,
  initBuffer,
  appendToBuffer,
  clearBuffer,
  closeBuffer,
  startRound,
  endRound,
  undoLastRound,
  getRoundCount,
  addLinesToCurrentRound
} from '../repl/buffer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const ACTIVITY_DIR = join(PROJECT_ROOT, 'activity');
const CONFIG_FILE = join(PROJECT_ROOT, 'config.yml');

// Global config cache
let globalConfig = null;

/**
 * Load global configuration from config.yml
 * @returns {Promise<object>} Global config object
 */
export async function loadGlobalConfig() {
  if (globalConfig) return globalConfig;
  
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = await readFile(CONFIG_FILE, 'utf8');
      globalConfig = parseYaml(content) || {};
    } else {
      globalConfig = {};
    }
  } catch (err) {
    console.error('Error loading config.yml:', err.message);
    globalConfig = {};
  }
  
  return globalConfig;
}

/**
 * Get the LLM shell command template from config
 * @returns {Promise<string|null>} LLM shell command template
 */
export async function getLlmShellCommand() {
  const config = await loadGlobalConfig();
  return config.llm_shell || null;
}

/**
 * Get the default agent from config
 * @returns {Promise<string>} Default agent name
 */
export async function getDefaultAgent() {
  const config = await loadGlobalConfig();
  return config.default_agent || 'text';
}

/**
 * Get the flash message timing factor from config
 * @returns {Promise<number>} Milliseconds per character (default 40)
 */
export async function getFlashMsPerChar() {
  const config = await loadGlobalConfig();
  return config.flash_ms_per_char || 40;
}

/**
 * Ensure activity directory exists
 */
export async function ensureActivityDir() {
  if (!existsSync(ACTIVITY_DIR)) {
    await mkdir(ACTIVITY_DIR, { recursive: true });
  }
}

/**
 * Load all activity files from the activity directory
 * @returns {Promise<object[]>} Array of activity objects
 */
export async function loadActivities() {
  await ensureActivityDir();
  
  const activities = [];
  
  try {
    const files = await readdir(ACTIVITY_DIR);
    const ymlFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    
    for (const file of ymlFiles) {
      const filePath = join(ACTIVITY_DIR, file);
      try {
        const content = await readFile(filePath, 'utf8');
        const activity = parseYaml(content);
        
        // Add file path for persistence
        activity._filePath = filePath;
        
        // Validate schema
        const validation = validateActivity(activity);
        if (!validation.valid) {
          console.error(`Warning: ${file} has errors:`, validation.errors);
        }
        
        // Validate hotkey conflicts
        const hotkeyConflicts = validateHotkeyConflicts(activity, content, filePath);
        if (hotkeyConflicts.length > 0) {
          for (const conflict of hotkeyConflicts) {
            console.error(`Error: Hotkey conflict in ${conflict.file}:${conflict.line1} and ${conflict.file}:${conflict.line2}`);
            console.error(`  Hotkey '${conflict.hotkey}' is used by both ${conflict.type1} '${conflict.name1}' and ${conflict.type2} '${conflict.name2}'`);
          }
          process.exit(1);
        }
        
        // Initialize runtime values
        initializeRuntimeValues(activity);
        
        activities.push(activity);
      } catch (err) {
        console.error(`Error loading ${file}:`, err.message);
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read
    console.error('Error reading activity directory:', err.message);
  }
  
  // Sort alphabetically by name
  activities.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  
  return activities;
}

/**
 * Validate that no hotkeys conflict within an activity
 * @param {object} activity - Parsed activity object
 * @param {string} content - Raw file content (for line number lookup)
 * @param {string} filePath - File path for error messages
 * @returns {Array} Array of conflict objects, empty if no conflicts
 */
function validateHotkeyConflicts(activity, content, filePath) {
  const conflicts = [];
  const hotkeyMap = new Map(); // hotkey -> { type, name, line }
  
  const lines = content.split('\n');
  // Use path relative to project root (e.g., 'activity/discord.yml')
  const relativeFilePath = relative(PROJECT_ROOT, filePath);
  
  /**
   * Find line number for a hotkey definition
   * @param {string} section - 'commands' or 'variables'
   * @param {string} name - Command key or variable name
   * @param {string} hotkey - The hotkey value (for variables)
   * @returns {number} Line number (1-indexed)
   */
  function findLineNumber(section, name, hotkey = null) {
    let inSection = false;
    let inItem = false;
    let itemStartLine = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Check for section start (top-level key ending with colon, no leading whitespace)
      if (!line.startsWith(' ') && !line.startsWith('\t')) {
        if (trimmed.startsWith(`${section}:`)) {
          inSection = true;
          inItem = false;
          continue;
        } else if (/^\w+:/.test(trimmed)) {
          // Another top-level section
          inSection = false;
          inItem = false;
          continue;
        }
      }
      
      if (!inSection) continue;
      
      if (section === 'commands') {
        // Commands: look for "key: command" pattern (indented)
        // Match patterns like: P:, "P":, 'P':
        const cmdMatch = trimmed.match(/^(['"]?)([^'":\s]+)\1\s*:/);
        if (cmdMatch && cmdMatch[2] === name) {
          return i + 1;
        }
      } else if (section === 'variables') {
        // Variables: look for variable name (indented, but less than nested properties)
        // Variable names are typically at 2-space indent, properties at 4-space
        const indent = line.match(/^(\s*)/)[1].length;
        
        // Variable name line (2-space indent typically, upper-case names)
        // Only match at the variable level (indent 2), not property level (indent 4+)
        if (indent > 0 && indent <= 2) {
          const varMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*:/);
          if (varMatch) {
            if (varMatch[1] === name) {
              inItem = true;
              itemStartLine = i + 1;
              continue;
            } else if (inItem) {
              // We've moved to a different variable
              inItem = false;
            }
          }
        }
        
        // Look for hotkey line within this variable (indent 4+)
        if (inItem && indent > 2) {
          // Match: hotkey: n OR hotkey: "n"
          const hotkeyMatch = trimmed.match(/^hotkey\s*:\s*["']?(\w)["']?/);
          if (hotkeyMatch) {
            return i + 1;
          }
        }
      }
    }
    
    // If we found the item but not the specific hotkey line, return the item start
    if (section === 'variables' && itemStartLine > 0) {
      return itemStartLine;
    }
    
    return 0; // Not found
  }
  
  // Collect command hotkeys (command keys are the hotkeys)
  if (activity.commands) {
    for (const [key, _cmd] of Object.entries(activity.commands)) {
      const line = findLineNumber('commands', key);
      const entry = { type: 'command', name: key, line };
      
      if (hotkeyMap.has(key)) {
        const existing = hotkeyMap.get(key);
        conflicts.push({
          file: relativeFilePath,
          hotkey: key,
          type1: existing.type,
          name1: existing.name,
          line1: existing.line,
          type2: entry.type,
          name2: entry.name,
          line2: entry.line
        });
      } else {
        hotkeyMap.set(key, entry);
      }
    }
  }
  
  // Collect variable hotkeys
  if (activity.variables) {
    for (const [name, def] of Object.entries(activity.variables)) {
      if (def.hotkey) {
        const hotkey = def.hotkey;
        const line = findLineNumber('variables', name, hotkey);
        const entry = { type: 'variable', name, line };
        
        if (hotkeyMap.has(hotkey)) {
          const existing = hotkeyMap.get(hotkey);
          conflicts.push({
            file: relativeFilePath,
            hotkey,
            type1: existing.type,
            name1: existing.name,
            line1: existing.line,
            type2: entry.type,
            name2: entry.name,
            line2: entry.line
          });
        } else {
          hotkeyMap.set(hotkey, entry);
        }
      }
    }
  }
  
  return conflicts;
}

/**
 * Initialize runtime values for an activity
 * @param {object} activity - Activity object
 */
function initializeRuntimeValues(activity) {
  activity._values = {};
  
  if (activity.variables) {
    for (const [name, def] of Object.entries(activity.variables)) {
      activity._values[name] = getDefaultValue(def);
    }
  }
}

/**
 * Save an activity back to its YAML file
 * @param {object} activity - Activity object
 */
export async function saveActivity(activity) {
  if (!activity._filePath) {
    throw new Error('Activity has no file path');
  }
  
  // Create a clean copy without runtime properties
  const clean = { ...activity };
  delete clean._filePath;
  delete clean._values;
  
  const yaml = stringifyYaml(clean);
  await writeFile(activity._filePath, yaml, 'utf8');
}

/**
 * Persist current variable values to the activity YAML file
 * Sets the 'value' field for each variable with its current runtime value
 * (separate from 'default' which can be a JS expression)
 * @param {object} activity - Activity object with _values
 */
export async function persistVariableValues(activity) {
  if (!activity._filePath) {
    throw new Error('Activity has no file path');
  }
  
  // Read the current file to preserve formatting and comments
  const content = await readFile(activity._filePath, 'utf8');
  const parsed = parseYaml(content);
  
  // Update the 'value' field with current runtime values
  if (parsed.variables && activity._values) {
    for (const [name, value] of Object.entries(activity._values)) {
      if (parsed.variables[name]) {
        // Handle undefined/null - delete the value key from YAML
        if (value === undefined || value === null || value === '') {
          delete parsed.variables[name].value;
        } else {
          // Set 'value' as a literal (not a JS expression)
          const def = parsed.variables[name];
          parsed.variables[name].value = formatLiteralValue(value, def);
        }
      }
    }
  }
  
  const yaml = stringifyYaml(parsed);
  await writeFile(activity._filePath, yaml, 'utf8');
}

/**
 * Format a runtime value as a literal for YAML 'value' field
 * @param {any} value - Runtime value
 * @param {object} def - Variable definition
 * @returns {any} Literal value for YAML
 */
function formatLiteralValue(value, def) {
  switch (def.type) {
    case 'int':
      return typeof value === 'number' ? value : parseInt(String(value), 10);
    case 'float':
      return typeof value === 'number' ? value : parseFloat(String(value));
    case 'string':
      return String(value);
    case 'enum':
      return String(value);
    case 'date':
      if (value instanceof Date) {
        // Store as ISO string
        return value.toISOString();
      }
      return String(value);
    default:
      return value;
  }
}

/**
 * Create a new activity file
 * @param {string} name - Activity name
 * @param {object} config - Activity configuration
 * @returns {Promise<object>} Created activity
 */
export async function createActivity(name, config = {}) {
  await ensureActivityDir();
  
  const activity = {
    ...getDefaultActivity(),
    ...config,
    name
  };
  
  const filePath = join(ACTIVITY_DIR, `${name}.yml`);
  activity._filePath = filePath;
  
  initializeRuntimeValues(activity);
  
  const yaml = stringifyYaml(activity);
  await writeFile(filePath, yaml, 'utf8');
  
  return activity;
}

/**
 * Get the activity directory path
 * @returns {string} Activity directory path
 */
export function getActivityDir() {
  return ACTIVITY_DIR;
}
