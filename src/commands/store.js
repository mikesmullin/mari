/**
 * In-memory variable store
 * Manages variable values across activities
 */

import { getDefaultValue, formatValue } from '../config/variables.js';

/**
 * Variable store class
 */
export class VariableStore {
  constructor() {
    this.activities = new Map(); // activity name -> { values, definitions }
    this.currentActivity = null;
  }
  
  /**
   * Register an activity with its variable definitions
   * @param {object} activity - Activity object
   */
  registerActivity(activity) {
    const values = {};
    const definitions = activity.variables || {};
    
    // Initialize all variables with defaults
    for (const [name, def] of Object.entries(definitions)) {
      values[name] = getDefaultValue(def);
    }
    
    // Merge any existing runtime values
    if (activity._values) {
      Object.assign(values, activity._values);
    }
    
    this.activities.set(activity.name, {
      values,
      definitions,
      activity
    });
  }
  
  /**
   * Set the current activity
   * @param {string} name - Activity name
   * @returns {boolean} True if activity exists
   */
  setCurrentActivity(name) {
    if (this.activities.has(name)) {
      this.currentActivity = name;
      return true;
    }
    return false;
  }
  
  /**
   * Get current activity name
   * @returns {string|null} Activity name
   */
  getCurrentActivityName() {
    return this.currentActivity;
  }
  
  /**
   * Get current activity data
   * @returns {object|null} Activity data
   */
  getCurrentActivity() {
    if (!this.currentActivity) return null;
    return this.activities.get(this.currentActivity);
  }
  
  /**
   * Get a variable value from current activity
   * @param {string} name - Variable name
   * @returns {any} Variable value
   */
  get(name) {
    const data = this.getCurrentActivity();
    if (!data) return undefined;
    return data.values[name];
  }
  
  /**
   * Set a variable value in current activity
   * @param {string} name - Variable name
   * @param {any} value - Value to set
   * @returns {boolean} True if variable exists
   */
  set(name, value) {
    const data = this.getCurrentActivity();
    if (!data || !data.definitions[name]) return false;
    data.values[name] = value;
    // Also update activity's runtime values
    if (data.activity._values) {
      data.activity._values[name] = value;
    }
    return true;
  }
  
  /**
   * Get variable definition from current activity
   * @param {string} name - Variable name
   * @returns {object|undefined} Variable definition
   */
  getDefinition(name) {
    const data = this.getCurrentActivity();
    if (!data) return undefined;
    return data.definitions[name];
  }
  
  /**
   * Get all variable values from current activity
   * @returns {object} Variable name -> value mapping
   */
  getAll() {
    const data = this.getCurrentActivity();
    if (!data) return {};
    return { ...data.values };
  }
  
  /**
   * Get all variable definitions from current activity
   * @returns {object} Variable name -> definition mapping
   */
  getAllDefinitions() {
    const data = this.getCurrentActivity();
    if (!data) return {};
    return { ...data.definitions };
  }
  
  /**
   * Get formatted display of all variables
   * @returns {string[]} Array of "NAME:value" strings
   */
  getFormattedDisplay() {
    const data = this.getCurrentActivity();
    if (!data) return [];
    
    const items = [];
    for (const [name, def] of Object.entries(data.definitions)) {
      const value = data.values[name];
      const formatted = formatValue(value, def);
      items.push(`${name}:${formatted}`);
    }
    return items;
  }
  
  /**
   * Reset a variable to its default value
   * @param {string} name - Variable name
   * @returns {boolean} True if variable exists
   */
  reset(name) {
    const data = this.getCurrentActivity();
    if (!data || !data.definitions[name]) return false;
    data.values[name] = getDefaultValue(data.definitions[name]);
    return true;
  }
  
  /**
   * Find variable by hotkey
   * @param {string} key - Hotkey character
   * @returns {{name: string, def: object}|null} Variable info or null
   */
  findByHotkey(key) {
    const data = this.getCurrentActivity();
    if (!data) return null;
    
    for (const [name, def] of Object.entries(data.definitions)) {
      if (def.hotkey === key) {
        return { name, def };
      }
    }
    return null;
  }
  
  /**
   * Get first variable in current activity
   * @returns {{name: string, def: object}|null} Variable info or null
   */
  getFirstVariable() {
    const data = this.getCurrentActivity();
    if (!data) return null;
    
    const entries = Object.entries(data.definitions);
    if (entries.length === 0) return null;
    
    const [name, def] = entries[0];
    return { name, def };
  }
  
  /**
   * Get next variable (cyclic)
   * @param {string} currentName - Current variable name
   * @returns {{name: string, def: object}|null} Variable info or null
   */
  getNextVariable(currentName) {
    const data = this.getCurrentActivity();
    if (!data) return null;
    
    const entries = Object.entries(data.definitions);
    if (entries.length === 0) return null;
    
    const idx = entries.findIndex(([name]) => name === currentName);
    if (idx === -1) return null;
    
    const nextIdx = (idx + 1) % entries.length;
    const [name, def] = entries[nextIdx];
    return { name, def };
  }
  
  /**
   * Get previous variable (cyclic)
   * @param {string} currentName - Current variable name
   * @returns {{name: string, def: object}|null} Variable info or null
   */
  getPrevVariable(currentName) {
    const data = this.getCurrentActivity();
    if (!data) return null;
    
    const entries = Object.entries(data.definitions);
    if (entries.length === 0) return null;
    
    const idx = entries.findIndex(([name]) => name === currentName);
    if (idx === -1) return null;
    
    const prevIdx = (idx - 1 + entries.length) % entries.length;
    const [name, def] = entries[prevIdx];
    return { name, def };
  }
  
  /**
   * Get list of activity names
   * @returns {string[]} Activity names
   */
  getActivityNames() {
    return Array.from(this.activities.keys()).sort();
  }
  
  /**
   * Get next activity name (cyclic)
   * @returns {string|null} Next activity name
   */
  getNextActivity() {
    const names = this.getActivityNames();
    if (names.length === 0) return null;
    const idx = names.indexOf(this.currentActivity);
    return names[(idx + 1) % names.length];
  }
  
  /**
   * Get previous activity name (cyclic)
   * @returns {string|null} Previous activity name
   */
  getPrevActivity() {
    const names = this.getActivityNames();
    if (names.length === 0) return null;
    const idx = names.indexOf(this.currentActivity);
    return names[(idx - 1 + names.length) % names.length];
  }
}

// Singleton instance
export const store = new VariableStore();
