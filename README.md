# Listy

A CAD-style hotkey-driven CLI tool with REPL mode for rapid command execution.

## Features

- **Hotkey-driven**: Single-key commands for instant execution
- **Activity-based**: Switch between different activity contexts (git, podman, trading, etc.)
- **Variable system**: Define and edit variables with type validation (int, float, string, enum, date)
- **VAR EDIT mode**: Real-time variable editing with MIDI jog wheel support (for fun)
- **Persistent values**: Variable values are saved to YAML and restored on restart
- **Configurable status bar**: Custom status format with variable substitution
- **Scroll region**: Clean terminal output with fixed status bar

## Installation

```bash
# Install dependencies
bun install

# Link globally
bun link
```

## Usage

```bash
# Start REPL mode
listy repl

# Start with specific activity
listy repl robin

# Shell mode (run single command)
listy <command> [args...]
```

## Keyboard Shortcuts

### NORMAL Mode
- `Tab` / `Shift+Tab` - Switch between activities
- `:` - Enter CMD mode
- `$` - Enter VAR EDIT mode
- `?` - Show available commands
- `Ctrl+L` - Clear screen
- `Ctrl+C` / `Ctrl+D` - Exit

### VAR EDIT Mode
- Variable hotkeys (e.g., `q`, `y`, `t`) - Select and edit variable (blanks input)
- `←` / `→` - Navigate between variables
- `↑` / `↓` or `+` / `-` - Increment/decrement value
- `Enter` - Apply changes and persist to disk
- `Escape` - Discard changes and exit

### CMD Mode
- `:set VAR VALUE` - Set variable value
- `:unset VAR` - Reset variable to default
- `:vars` - List all variables
- `:help` - Show help

## Activity Configuration

Activities are defined in YAML files in the `activity/` directory:

```yaml
name: example
description: Example Activity
color: "#3a86ff"
statusFormat: "${VAR1} - ${VAR2}"

env:
  FORCE_COLOR: "1"

variables:
  VAR1:
    type: string
    default: "'hello'"
    hotkey: v

  COUNT:
    type: int
    default: "10"
    range: [1, 100]
    step: 1
    hotkey: c

commands:
  R: echo "Running with $VAR1 count=$COUNT"
  S: echo "Status check"
```

### Variable Types

- `string` - Text value
- `int` - Integer with optional range and step
- `float` - Floating point with optional range and step
- `enum` - One of a fixed set of values
- `date` - Date value with range and step (days)