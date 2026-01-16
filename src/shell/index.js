/**
 * Shell mode CLI parser
 * Handles traditional CLI invocation for scripting/piping
 */

import { store } from '../commands/store.js';
import { executeCommand, getCommandKeys } from '../commands/executor.js';
import { parseValue, formatValue, getDefaultValue } from '../config/variables.js';

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {object} Parsed arguments
 */
export function parseArgs(args) {
  const result = {
    command: null,
    input: null,
    options: {},
    flags: [],
    positional: []
  };
  
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      // Long option
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        result.options[key] = value;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        const key = arg.slice(2);
        result.options[key] = args[i + 1];
        i++;
      } else {
        result.flags.push(arg.slice(2));
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short flag
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        result.options[key] = args[i + 1];
        i++;
      } else {
        result.flags.push(key);
      }
    } else {
      // Positional
      if (result.command === null) {
        result.command = arg;
      } else {
        result.positional.push(arg);
      }
    }
    
    i++;
  }
  
  // First positional after command is input
  if (result.positional.length > 0) {
    result.input = result.positional.join(' ');
  }
  
  return result;
}

/**
 * Apply options to variables and activity
 * @param {object} options - Option name -> value mapping
 * @returns {boolean} True if activity was changed
 */
function applyOptions(options) {
  // Handle activity option first
  if (options.activity || options.a) {
    const activityName = options.activity || options.a;
    store.setCurrentActivity(activityName);
  }
  
  // Map common option names to variable names
  const optionMap = {
    'qty': 'QTY',
    'symbol': 'SYMBOL',
    'exp': 'EXP',
    'strike': 'STRIKE',
    'type': 'TYPE',
    'price': 'PRICE'
  };
  
  for (const [opt, value] of Object.entries(options)) {
    const varName = optionMap[opt.toLowerCase()] || opt.toUpperCase();
    const def = store.getDefinition(varName);
    if (def) {
      const parsed = parseValue(value, def);
      if (parsed !== null) {
        store.set(varName, parsed);
      }
    }
  }
}

/**
 * Handle 'set' command
 * @param {string[]} args - Arguments (VAR=VALUE pairs or VAR VALUE)
 */
export async function handleSet(args) {
  for (const arg of args) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx > 0) {
      const varName = arg.slice(0, eqIdx);
      const value = arg.slice(eqIdx + 1);
      const def = store.getDefinition(varName);
      if (def) {
        const parsed = parseValue(value, def);
        if (parsed !== null) {
          store.set(varName, parsed);
          console.log(`${varName}=${formatValue(parsed, def)}`);
        } else {
          console.error(`Invalid value for ${varName}: ${value}`);
        }
      } else {
        console.error(`Unknown variable: ${varName}`);
      }
    }
  }
}

/**
 * Handle 'vars' command
 */
export async function handleVars() {
  const values = store.getAll();
  const definitions = store.getAllDefinitions();
  
  for (const [name, value] of Object.entries(values)) {
    const def = definitions[name];
    const formatted = def ? formatValue(value, def) : String(value);
    console.log(`${name}=${formatted}`);
  }
}

/**
 * Handle 'commands' command
 */
export async function handleCommands() {
  const activityData = store.getCurrentActivity();
  if (!activityData) {
    console.error('No activity loaded');
    return;
  }
  
  const commands = activityData.activity.commands || {};
  for (const [key, template] of Object.entries(commands)) {
    console.log(`${key}: ${template}`);
  }
}

/**
 * Handle 'activities' command
 */
export async function handleActivities() {
  const names = store.getActivityNames();
  const current = store.getCurrentActivityName();
  
  for (const name of names) {
    const marker = name === current ? '* ' : '  ';
    console.log(`${marker}${name}`);
  }
}

/**
 * Run a command in shell mode
 * @param {object} parsed - Parsed arguments
 * @returns {Promise<number>} Exit code
 */
export async function runShellCommand(parsed) {
  const { command, input, options, flags } = parsed;
  
  // Apply options to variables
  applyOptions(options);
  
  // Built-in commands
  switch (command) {
    case 'set':
      await handleSet(parsed.positional);
      return 0;
      
    case 'vars':
      await handleVars();
      return 0;
      
    case 'commands':
      await handleCommands();
      return 0;
      
    case 'activities':
      await handleActivities();
      return 0;
      
    case 'use':
      if (parsed.positional[0]) {
        if (store.setCurrentActivity(parsed.positional[0])) {
          console.log(`Using activity: ${parsed.positional[0]}`);
          return 0;
        } else {
          console.error(`Unknown activity: ${parsed.positional[0]}`);
          return 1;
        }
      }
      console.error('Usage: listy use <activity>');
      return 1;
      
    case 'help':
      printHelp();
      return 0;
  }
  
  // Check if command is a known command key
  const commandKeys = getCommandKeys();
  if (commandKeys.includes(command)) {
    const result = await executeCommand(command, input || '', {
      onStdout: (data) => process.stdout.write(data),
      onStderr: (data) => process.stderr.write(data)
    });
    
    if (result) {
      return result.code;
    }
  }
  
  console.error(`Unknown command: ${command}`);
  console.error('Run "listy help" for usage');
  return 1;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
listy - CAD-style hotkey-driven CLI

USAGE:
  listy [options] <command> [args...]
  listy repl                    Start interactive REPL mode

BUILT-IN COMMANDS:
  set VAR=VALUE [...]           Set variable values
  vars                          List all variables
  commands                      List available commands
  activities                    List available activities
  use <activity>                Switch to activity
  help                          Show this help

OPTIONS:
  -a, --activity <name>         Use specified activity
  --qty <n>                     Set QTY variable
  --symbol <sym>                Set SYMBOL variable
  --exp <date>                  Set EXP variable (M/d format)
  --strike <n>                  Set STRIKE variable
  --type <call|put>             Set TYPE variable
  --price <n>                   Set PRICE variable

EXAMPLES:
  listy -a podman ps            Run podman ps
  listy -a git s                Run git status
  listy b --symbol SPY --qty 5  Buy with options
  listy set SYMBOL=IWM QTY=10   Set multiple variables
  listy vars                    Show current values
  listy repl                    Start REPL mode
`);
}
