/**
 * Main entry point dispatcher
 * Routes between REPL and Shell modes
 */

import { loadActivities } from './config/loader.js';
import { store } from './commands/store.js';
import { Repl } from './repl/index.js';
import { parseArgs, runShellCommand } from './shell/index.js';

/**
 * Initialize the application
 * @returns {Promise<boolean>} True if initialized successfully
 */
export async function initialize() {
  // Load activities
  const activities = await loadActivities();
  
  if (activities.length === 0) {
    console.log('No activities found. Creating default activity...');
    // Create a minimal default activity
    const defaultActivity = {
      name: 'default',
      description: 'Default activity',
      variables: {},
      commands: {},
      _values: {}
    };
    activities.push(defaultActivity);
  }
  
  // Register activities with store
  for (const activity of activities) {
    store.registerActivity(activity);
  }
  
  // Set first activity as current
  if (activities.length > 0) {
    store.setCurrentActivity(activities[0].name);
  }
  
  return true;
}

/**
 * Run in REPL mode
 * @param {object} options - REPL options
 */
export async function runRepl(options = {}) {
  await initialize();
  
  // Set starting activity if specified
  if (options.activity) {
    if (!store.setCurrentActivity(options.activity)) {
      console.error(`Unknown activity: ${options.activity}`);
      console.error(`Available: ${store.getActivityNames().join(', ')}`);
      process.exit(1);
    }
  }
  
  // Apply initial options to variables
  if (options.symbol) {
    const def = store.getDefinition('SYMBOL');
    if (def) store.set('SYMBOL', options.symbol);
  }
  if (options.qty) {
    const def = store.getDefinition('QTY');
    if (def) store.set('QTY', parseInt(options.qty, 10));
  }
  
  const repl = new Repl();
  await repl.start();
  process.exit(0);
}

/**
 * Run in Shell mode
 * @param {string[]} args - Command line arguments
 * @returns {Promise<number>} Exit code
 */
export async function runShell(args) {
  await initialize();
  
  const parsed = parseArgs(args);
  
  if (!parsed.command) {
    // No command - show help
    console.log('Usage: listy <command> [args...] or listy repl');
    console.log('Run "listy help" for more information');
    return 0;
  }
  
  return runShellCommand(parsed);
}

/**
 * Main entry point
 * @param {string[]} args - Command line arguments
 */
export async function main(args) {
  // Check for repl mode
  if (args[0] === 'repl') {
    const options = {};
    
    // Parse repl options
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--symbol' && args[i + 1]) {
        options.symbol = args[i + 1];
        i++;
      } else if (arg === '--qty' && args[i + 1]) {
        options.qty = args[i + 1];
        i++;
      } else if (!arg.startsWith('-')) {
        // Positional argument is the starting activity
        options.activity = arg;
      }
    }
    
    await runRepl(options);
    return;
  }
  
  // Shell mode
  const code = await runShell(args);
  process.exit(code);
}
