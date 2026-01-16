/**
 * Activity file loader
 * Reads YAML activity files from ./activity/
 */

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseYaml, stringifyYaml } from '../utils/yaml.js';
import { validateActivity, getDefaultActivity } from './schema.js';
import { getDefaultValue } from './variables.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const ACTIVITY_DIR = join(PROJECT_ROOT, 'activity');

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
