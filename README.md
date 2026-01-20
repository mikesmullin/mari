# Marionette (`mari`)

Rapid hotkey-driven shell execution.

## Screenshot

![screenshot](docs/20260116-011117-screenshot.png)

## Features

- **Hotkey-driven**: Single-key commands for instant execution
- **Activity-based**: Switch between different activity contexts (git, podman, trading, etc.)
- **Variable system**: Define and edit variables with type validation (int, float, string, enum, date)
- **VAR EDIT mode**: Real-time variable editing with MIDI jog wheel support (for fun)
- **LLM mode**: Send prompts to a configured LLM with scrollback buffer as context
- **LLM context chaining**: Activity-controlled LLM context with skills-based pattern matching
- **SHELL mode**: Execute raw shell commands without leaving the REPL
- **WORD mode**: Type word commands instead of hotkeys
- **VOICE mode**: Execute commands via speech using perception-voice service
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

### Global Hotkeys
These work in all modes:
- `Ctrl+L` - Clear screen and buffer
- `Ctrl+C` / `Ctrl+D` - Exit
- `Ctrl+X, u` - Undo last execution round (removes from buffer)

### NORMAL Mode
- `Tab` / `Shift+Tab` - Switch between activities
- `:` - Enter CMD mode
- `$` - Enter VAR EDIT mode
- `@` - Enter LLM mode
- `!` - Enter SHELL mode
- `%` - Enter WORD mode
- `#` - Enter VOICE mode
- `?` - Show available commands

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

### LLM Mode
- Type your prompt, `Enter` to submit (stays in LLM mode)
- `Escape` - Exit to NORMAL mode
- `@agent` prefix - Specify agent (e.g., `@solo what is 2+2?` sets `$_AGENT=solo`)

The prompt is sent to the command configured in `config.yml`. The scrollback buffer (`buffer.log`) is available as context via `$_BUFFER`.

### SHELL Mode
- Type a shell command, `Enter` to execute (stays in SHELL mode)
- `Escape` - Exit to NORMAL mode

### WORD Mode
- Type a word and press `Enter` to execute the matching command
- Hotkeys are disabled in this mode
- `Escape` - Exit to NORMAL mode

Commands can define a `word` property that matches typed input:
```yaml
commands:
  b:
    shell: subd -v -t home turn all lights blue
    word: blue
```
In WORD mode, typing `blue` + Enter executes the command.

### VOICE Mode
- Listens to speech via `perception-voice` service
- Transcriptions are matched against `voice` regex patterns
- `Escape` - Exit to NORMAL mode

Commands can define a `voice` property (regex pattern):
```yaml
commands:
  b:
    shell: subd -v -t home turn all lights blue
    voice: '(lights|blue)'
```
In VOICE mode, saying "turn on the lights" or "make it blue" triggers the command.

## Global Configuration

Create `config.yml` in the project root for global settings:

```yaml
# Command executed when submitting input in LLM mode (@)
# $* is replaced with the user's input string
# $_BUFFER is the path to buffer.log (scrollback capture)
# $_AGENT is the agent name, parsed from @agent prefix or default_agent
#   e.g. input "@solo what is 2+2?" sets $_AGENT=solo, $*="what is 2+2?"
default_agent: text
llm_shell: cat $_BUFFER | subd -t "$_AGENT" "$*"
```

### Buffer Logging

All stdout/stderr from executed commands is captured to `buffer.log` in the project root. This file is:
- Appended to on each command output
- Truncated when `Ctrl+L` is pressed
- Available in LLM mode via `$_BUFFER` for providing context to the LLM

## Activity Configuration

Activities are defined in YAML files in the `activity/` directory:

```yaml
name: robin
description: Stock & Options Trading
color: "#6a994e"
statusFormat: ${SYMBOL} ${EXP} $${STRIKE} ${TYPE} ${QTY} con @ $${PRICE}
variables:
  QTY:
    type: int
    default: "10"
    range:
      - 1
      - 100
    step: 1
    format: "%d"
    hotkey: q
    value: 48
  SYMBOL:
    type: string
    default: "'TSLA'"
    hotkey: "y"
    value: IWM
  EXP:
    type: date
    default: new Date()
    range: 2025-01-01..2026-12-31
    step: 1
    format: M/d
    hotkey: x
    value: "2026-01-16T07:27:56.906Z"
  STRIKE:
    type: float
    default: "225.0"
    range:
      - 1
      - 9999
    step: 0.5
    format: "%.0f"
    hotkey: t
    value: 265.5
  TYPE:
    type: enum
    default: "'call'"
    range:
      - call
      - put
    hotkey: c
    value: put
  PRICE:
    type: float
    default: "0.50"
    range:
      - 0.01
      - 999.99
    step: 0.01
    format: "%.2f"
    hotkey: l
    value: 0.2899999999999999
commands:
  Q: robin shares quote "$SYMBOL"
  W: robin option quote "$SYMBOL" "$EXP" "$STRIKE" "$TYPE"
  A: robin -y option buy "$QTY" "$SYMBOL" "$EXP" "$STRIKE" "$TYPE" limit ask+1
  b: robin -y option buy "$QTY" "$SYMBOL" "$EXP" "$STRIKE" "$TYPE" limit "$PRICE"
  S: robin -y option sell "$QTY" "$SYMBOL" "$EXP" "$STRIKE" "$TYPE" limit "$PRICE"
  Z: robin -y option sell all "$SYMBOL" "$EXP" "$STRIKE" "$TYPE" limit ask-1
  P: robin positions
  R: robin orders open
  O: robin orders all
  X: robin cancel "$SYMBOL"
aliases:
  fri: (() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return d; })()
```

### Variable Types

- `string` - Text value
- `int` - Integer with optional range and step
- `float` - Floating point with optional range and step
- `enum` - One of a fixed set of values
- `date` - Date value with range and step (days)

## LLM Context Chaining

Activities can define custom LLM context that gets injected when entering LLM mode. This allows the LLM to understand the activity's conventions and take appropriate actions.

### Activity-Level Context (`llm_context`)

Define a multi-line template in your activity YAML that controls what the LLM "sees":

```yaml
name: discord
llm_context: |
  # Discord Activity Context
  
  You are operating in the Discord activity. When processing items:
  
  ## File Locations
  - Messages are stored at: ~/.discord/messages/
  - Filename pattern: <id>.yml
  
  ## Available Actions
  - merge_yaml(file_path, yaml_data) — deep merge into target file
  
  ## Additional Instructions
  $_LLM_PREPEND
  
  ## Current Screen
  $_SCREEN
```

### Special Variables

| Variable | Description |
|----------|-------------|
| `$_SCREEN` | Content of all command rounds (what's currently on screen) |
| `$_LLM_PREPEND` | Skill-specific instructions injected based on user input patterns |

### Skills (Pattern-Based Context)

Define patterns that match user input in LLM mode. When matched, the skill's `llm_prepend` is injected into `$_LLM_PREPEND`:

```yaml
skills:
  - pattern: 'prioriti[sz]e'
    llm_prepend: |
      ## Priority Task
      When prioritizing items:
      - Use scale 1-10 (10 = highest)
      - Extract the ID from [abc123] format
      - Call merge_yaml(~/.discord/messages/<id>.yml, {priority: N})
      
  - pattern: 'summariz|recap|overview'
    llm_prepend: |
      ## Summary Task
      Provide a concise summary of the listed items.
```

**How it works:**
1. User enters LLM mode (`@`)
2. User types: `prioritize items 2 and 5`
3. Mari matches against `skills[].pattern` (regex, case-insensitive)
4. Matched skill's `llm_prepend` is added to `$_LLM_PREPEND`
5. `llm_context` is expanded with the skill instructions
6. LLM receives activity-specific guidance for the task

Multiple patterns can match — all matching `llm_prepend` values are concatenated.