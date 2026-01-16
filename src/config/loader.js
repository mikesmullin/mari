/**
 * Activity file loader
 * Reads YAML activity files from ~/.config/listy/activity/ and ./activity/
 */

import { readdir, readFile, writeFile, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { parseYaml, stringifyYaml } from '../utils/yaml.js';
import { validateActivity, getDefaultActivity } from './schema.js';
import { getDefaultValue } from './variables.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const PROJECT_ACTIVITY_DIR = join(PROJECT_ROOT, 'activity');

const CONFIG_DIR = join(homedir(), '.config', 'listy');
const ACTIVITY_DIR = join(CONFIG_DIR, 'activity');

/**
 * Ensure config directories exist and copy default activities
 */
export async function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(ACTIVITY_DIR)) {
    await mkdir(ACTIVITY_DIR, { recursive: true });
  }
  
  // Copy default activities if config dir is empty
  try {
    const configFiles = await readdir(ACTIVITY_DIR);
    const ymlFiles = configFiles.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    
    if (ymlFiles.length === 0 && existsSync(PROJECT_ACTIVITY_DIR)) {
      const defaultFiles = await readdir(PROJECT_ACTIVITY_DIR);
      for (const file of defaultFiles.filter(f => f.endsWith('.yml'))) {
        await copyFile(
          join(PROJECT_ACTIVITY_DIR, file),
          join(ACTIVITY_DIR, file)
        );
      }
    }
  } catch (err) {
    // Ignore errors during copy
  }
}

/**
 * Load all activity files from the config directory
 * @returns {Promise<object[]>} Array of activity objects
 */
export async function loadActivities() {
  await ensureConfigDir();
  
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
        
        // Validate
        const validation = validateActivity(activity);
        if (!validation.valid) {
          console.error(`Warning: ${file} has errors:`, validation.errors);
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
 * Create a new activity file
 * @param {string} name - Activity name
 * @param {object} config - Activity configuration
 * @returns {Promise<object>} Created activity
 */
export async function createActivity(name, config = {}) {
  await ensureConfigDir();
  
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
 * Get the config directory path
 * @returns {string} Config directory path
 */
export function getConfigDir() {
  return CONFIG_DIR;
}

/**
 * Get the activity directory path
 * @returns {string} Activity directory path
 */
export function getActivityDir() {
  return ACTIVITY_DIR;
}
