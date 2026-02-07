# Mari - Project Plan

## Overview

**Mari** is a prototype CLI tool inspired by CAD-style keyboard input (Blender/AutoCAD) that provides fast, hotkey-driven command execution. It supports both real-time REPL interaction and traditional POSIX shell composition.

---

## Architecture

### Two Modes

| Mode   | Description                                                                 |
|--------|-----------------------------------------------------------------------------|
| REPL   | Real-time raw stdin input with statusbar display (vim-like)                 |
| SHELL  | Traditional CLI invocation for scripting/piping (`mari cmd args...`)       |

### Input Sources

- Keyboard (raw stdin in REPL mode)
- Jog wheel (MIDI CC controller 0x0A, CW/CCW events via `/dev/snd/midiC*`)

---

## Configuration: Activity Files

### Multi-Activity Architecture

Instead of a single `config.yml`, mari uses multiple **activity files** located under:

```
~/.config/mari/activity/
├── robin.yml       # Stock/options trading (robin CLI)
├── git.yml         # Git operations
├── docker.yml      # Container management
├── notes.yml       # Note-taking commands
└── ...             # Any number of activities
```

On startup, mari reads all `activity/*.yml` files and makes them available.

### Activity Switching

| Key     | Action                                      |
|---------|---------------------------------------------|
| `Tab`   | Rotate to next activity (cyclic)            |
| `S-Tab` | Rotate to previous activity                 |

The current activity is always visible in the statusbar (leftmost position).

---

### Example: `activity/robin.yml`

```yaml
# ~/.config/mari/activity/robin.yml
name: robin
description: Stock & Options Trading

# ─────────────────────────────────────────────────────────────────
# VARIABLES
# ─────────────────────────────────────────────────────────────────
# Variables are scoped to this activity.
# All default values are JS expressions (evaluated at activity load).
# Variables can be set inline before a command key.
#
variables:
  QTY:
    type: int
    default: "10"                     # JS expression: evaluates to 10
    range: [1, 100]
    step: 1
    format: "%d"
    hotkey: q

  SYMBOL:
    type: string
    default: "'TSLA'"                 # JS expression: evaluates to "TSLA"
    hotkey: y                         # 'y' for sYmbol

  EXP:
    type: date
    default: "new Date()"             # JS: current date
    range: 2025-01-01..2026-12-31
    step: 1
    format: "M/d"
    hotkey: x                         # 'x' for eXpiration

  STRIKE:
    type: float
    default: "225.0"
    range: [1.0, 9999.0]
    step: 0.5
    format: "%.0f"                    # no decimal for display
    hotkey: t                         # 't' for sTrike

  TYPE:
    type: enum
    default: "'call'"
    range: [call, put]
    hotkey: c                         # 'c' for Call/put

  PRICE:
    type: float
    default: "0.50"
    range: [0.01, 999.99]
    step: 0.01
    format: "%.2f"
    hotkey: l                         # 'l' for Limit price

# ─────────────────────────────────────────────────────────────────
# COMMANDS
# ─────────────────────────────────────────────────────────────────
# Hotkey -> shell command template
# Variables are substituted using $VAR or ${VAR}
#
commands:
  # Stock quote: sq<SYMBOL><Enter>  e.g. sqTSLA<Enter>
  sq: robin shares quote $INPUT

  # Option quote
  oq: robin option quote $INPUT

  # Quick buy (uses preset variables)
  b: robin option buy "$QTY" "$SYMBOL" "$EXP" "$STRIKE" "$TYPE" limit "$PRICE"

  # Quick sell
  S: robin option sell "$QTY" "$SYMBOL" "$EXP" "$STRIKE" "$TYPE" limit "$PRICE"

  # Positions
  P: robin positions

  # Orders
  o: robin orders open
  O: robin orders all

  # Cancel order
  x: robin cancel $INPUT

# ─────────────────────────────────────────────────────────────────
# JOG WHEEL
# ─────────────────────────────────────────────────────────────────
# Jog wheel and +/- keys only affect variables while in VAR EDIT mode.
# No default binding — the jog wheel is inactive in NORMAL mode.
jog:
  # (no default binding)

# ─────────────────────────────────────────────────────────────────
# ALIASES
# ─────────────────────────────────────────────────────────────────
# All alias values are JS expressions (evaluated at command execution time)
aliases:
  fri: "(() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return d; })()"
  nxt: "(() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7) + 7); return d; })()"
  mon: "new Date('2026-01-31')"
```

---

### Variable Definition Schema

**Variables are scoped to their activity.** Each activity has its own independent set of variables.
**Variable changes are persisted in real-time** to the activity's YAML file.

```yaml
variables:
  VAR_NAME:
    type: int | float | string | enum | date
    default: "<js-expression>"          # JS expression (evaluated at command execution)
    range: [min, max] | [val1, ...] | YYYY-MM-DD..YYYY-MM-DD
    step: <number>                      # Increment for jog/+/- (optional)
    format: "<format-string>"           # Display format (optional)
    hotkey: <key>                       # Inline variable shortcut (optional)
    validate: "<regex>"                 # Validation pattern (optional)
```

| Type     | Range Format                 | Default if omitted      | Jog/+/- Behavior                          |
|----------|------------------------------|-------------------------|-------------------------------------------|
| `int`    | `[min, max]`                 | `"0"`                   | Increment/decrement by `step` (default 1) |
| `float`  | `[min, max]`                 | `"0.0"`                 | Increment/decrement by `step`             |
| `string` | (none)                       | `"''"`                  | N/A (manual entry only)                   |
| `enum`   | `[val1, val2, val3, ...]`    | first value as JS       | Rotate through values in order            |
| `date`   | `YYYY-MM-DD..YYYY-MM-DD`     | `"new Date()"`          | Increment/decrement by `step` days        |

**All `default` values are JavaScript expressions:**
```yaml
# Literal values (still JS)
default: "10"              # number
default: "'TSLA'"          # string (note the quotes)
default: "0.50"            # float

# Dynamic values
default: "new Date()"                              # current date
default: "parseInt(process.env.QTY) || 10"         # env var with fallback
default: "(() => { /* complex logic */ })()"
```

---

### Dynamic Defaults (All JS)

**All default values are JavaScript expressions**, evaluated at command execution time:

```yaml
variables:
  # Simple literal (still valid JS)
  QTY:
    type: int
    default: "10"

  # Current date
  TODAY:
    type: date
    default: "new Date()"
    format: "M/d"

  # Next Friday
  NEXT_FRIDAY:
    type: date
    default: |
      (() => {
        const d = new Date();
        d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
        return d;
      })()
    format: "M/d"

  # Env var with fallback
  QTY:
    type: int
    default: "parseInt(process.env.DEFAULT_QTY) || 10"
    range: [1, 100]
```

---

### Date Formatting

Date format uses a simplified pattern syntax:

| Token | Meaning          | Example      |
|-------|------------------|--------------|
| `M`   | Month (1-12)     | `1`, `12`    |
| `MM`  | Month (01-12)    | `01`, `12`   |
| `d`   | Day (1-31)       | `5`, `25`    |
| `dd`  | Day (01-31)      | `05`, `25`   |
| `yy`  | Year (2-digit)   | `25`, `26`   |
| `yyyy`| Year (4-digit)   | `2025`       |

**Format Examples:**
- `"M/d"` → `1/17`
- `"MM/dd"` → `01/17`
- `"M/d/yy"` → `1/17/25`
- `"yyyy-MM-dd"` → `2025-01-17`

---

**Validation:**
- If `validate` regex is provided, `Enter` is a no-op until value passes
- Invalid state shown in statusbar (e.g., red highlight or `[!]` indicator)
- For `date` type, value must be within `range` bounds

**Printf Format Examples (for int/float):**
- `"%d"` → `10`
- `"%.2f"` → `0.45`
- `"$%.2f"` → `$0.45`
- `"%03d"` → `010`

---

## Input Modes (REPL)

### Statusbar Layout

The statusbar is always visible at the bottom and arranged as:

```
[ACTIVITY] [COMMAND INPUT]                              [STATE]
```

| Section         | Description                                              |
|-----------------|----------------------------------------------------------|
| `[ACTIVITY]`    | Current activity name (e.g., `robin`, `git`)             |
| `[COMMAND INPUT]` | What the user is typing / current command buffer       |
| `[STATE]`       | Variable summary, jog target, validation status          |

---

### Mode Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│                        NORMAL MODE                              │
│                (limbo - ignores most input)                     │
│                                                                 │
│   Press `:` ─────────────────► CMD MODE                         │
│   Press `@` ─────────────────► LLM MODE                         │
│   Press `Tab` ───────────────► Rotate to next activity          │
│   Press var hotkey ──────────► Begin inline variable input      │
│   Press cmd hotkey ──────────► Execute command (immediate)      │
│                                                                 │
│   Jog wheel / +/- have NO effect in NORMAL mode                 │
│   Esc from any mode ─────────► returns to NORMAL                │
└─────────────────────────────────────────────────────────────────┘
```

| Mode      | Trigger       | Purpose                                      | Exit          |
|-----------|---------------|----------------------------------------------|---------------|
| NORMAL    | (default)     | Idle state; hotkey dispatch                  | —             |
| CMD       | `:`           | Execute commands, set variables              | `Esc`/`Enter` |
| INPUT     | var hotkey    | Inline variable entry (jog/+/-/type active)  | value or cmd  |
| LLM       | `@`           | Send prompts to LLM with buffer context      | `Esc`         |

---

### Inline Command Composition

Variables can be set **inline** before pressing a command key. This allows rapid command entry without explicit `:set` or `Enter` for each variable.

**Syntax:** `<var><value><var><value>...<CMD>`

- **Variable hotkeys** (e.g., `q`, `y`, `x`, `t`, `c`, `l`) begin value input for that variable
- **While entering a variable value:**
  - Jog wheel CW/CCW and `+`/`-` keys adjust the value
  - Typing directly sets the value
  - Pressing another variable hotkey commits current and starts next
  - Pressing a command key commits current and executes command
- **Command keys** (e.g., `S`, `B`) execute immediately (no `Enter` needed)
- Any variable not set inline uses its current/default value

**Example:**
```
Input: q10yTSLAx1/12t256cl.35S

Breakdown:
  q10      → QTY = 10
  yTSLA    → SYMBOL = "TSLA"
  x1/12    → EXP = 1/12 (date)
  t256     → STRIKE = 256
  c        → TYPE = call (pressing 'c' toggles, or use +/-)
  l.35     → PRICE = 0.35
  S        → Execute SELL command

Result: robin option sell 10 TSLA 1/12 256 call limit 0.35
```

**All of these are valid:**
```
S                    # Use all current/default values
yTSLAS               # Only change SYMBOL, use rest as-is
yTSLAq1S             # Change SYMBOL and QTY
q+++++S              # Increment QTY 5 times, then sell
```

---

### Variable Display

**All variable values are visible on-screen** while in INPUT mode:

```
┌──────────────────────────────────────────────────────────────────┐
│ QTY:10  SYMBOL:TSLA  EXP:1/17  STRIKE:256  TYPE:call  PRICE:0.50 │
├──────────────────────────────────────────────────────────────────┤
│ [robin] q10yTSLAx1/12█                                           │
└──────────────────────────────────────────────────────────────────┘
```

The variable currently being edited is highlighted. Values update in real-time as you type or use jog/+/-.

---

## REPL Mode Session Examples

### Example 1: Quick Stock Quote

**Initial screen (NORMAL mode):**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                         (empty viewport)                         │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                                            -- NORMAL --  │
└──────────────────────────────────────────────────────────────────┘
```

**User types: `s` `q`**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                         (empty viewport)                         │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin] sq█                                  [CMD: shares quote] │
└──────────────────────────────────────────────────────────────────┘
```

**User types: `T` `S` `L` `A`**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                         (empty viewport)                         │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin] sqTSLA█                              [CMD: shares quote] │
└──────────────────────────────────────────────────────────────────┘
```

**User presses `Enter` — command executes:**
```
┌──────────────────────────────────────────────────────────────────┐
│ $ robin shares quote TSLA                                        │
│ TSLA: $421.35 (+2.4%)                                            │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                                            -- NORMAL --  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Example 2: Setting Variables and Buying Options

**User presses `:` (enters CMD mode):**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin] :█                                                       │
└──────────────────────────────────────────────────────────────────┘
```

**User types: `set SYMBOL IWM`**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin] :set SYMBOL IWM█                                         │
└──────────────────────────────────────────────────────────────────┘
```

**User presses `Enter`:**
```
┌──────────────────────────────────────────────────────────────────┐
│ SYMBOL=IWM                                                       │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                                    -- NORMAL --    $IWM  │
└──────────────────────────────────────────────────────────────────┘
```

**User sets more variables via `:`**
```
:set EXP 1/17
:set STRIKE 225
:set TYPE put
:set PRICE 0.45
:set QTY 5
```

**Statusbar now shows active context:**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                            5x IWM 1/17 225p @ $0.45      │
└──────────────────────────────────────────────────────────────────┘
```

**User presses `b` (buy hotkey):**
```
┌──────────────────────────────────────────────────────────────────┐
│ $ robin option buy 5 IWM 1/17 225 put limit 0.45                 │
│ Order submitted: BUY 5x IWM 1/17 225P @ $0.45                    │
│ Order ID: abc123def456                                           │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                            5x IWM 1/17 225p @ $0.45      │
└──────────────────────────────────────────────────────────────────┘
```

---

### Example 3: Activity Switching

**User presses `Tab` to switch activity:**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [git]                                              -- NORMAL --  │
└──────────────────────────────────────────────────────────────────┘
```

**User presses `Tab` again:**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [docker]                                           -- NORMAL --  │
└──────────────────────────────────────────────────────────────────┘
```

**User presses `Tab` again (cycles back):**
```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                                            -- NORMAL --  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Example 4: Inline Command Composition

**User starts typing in NORMAL mode - presses `q` (QTY hotkey):**
```
┌──────────────────────────────────────────────────────────────────┐
│ QTY:10  SYMBOL:TSLA  EXP:1/15  STRIKE:225  TYPE:call  PRICE:0.50 │
├──────────────────────────────────────────────────────────────────┤
│ [robin] q█                                                       │
└──────────────────────────────────────────────────────────────────┘
```

**User types `10` then presses `y` (SYMBOL hotkey):**
```
┌──────────────────────────────────────────────────────────────────┐
│ QTY:10  SYMBOL:TSLA  EXP:1/15  STRIKE:225  TYPE:call  PRICE:0.50 │
├──────────────────────────────────────────────────────────────────┤
│ [robin] q10y█                                                    │
└──────────────────────────────────────────────────────────────────┘
```

**User types `TSLA` then presses `x` (EXP hotkey):**
```
┌──────────────────────────────────────────────────────────────────┐
│ QTY:10  SYMBOL:TSLA  EXP:1/15  STRIKE:225  TYPE:call  PRICE:0.50 │
├──────────────────────────────────────────────────────────────────┤
│ [robin] q10yTSLAx█                                               │
└──────────────────────────────────────────────────────────────────┘
```

**User types `1/12` then presses `t` then `256` then `c` then `l` then `.35`:**
```
┌──────────────────────────────────────────────────────────────────┐
│ QTY:10  SYMBOL:TSLA  EXP:1/12  STRIKE:256  TYPE:call  PRICE:0.35 │
├──────────────────────────────────────────────────────────────────┤
│ [robin] q10yTSLAx1/12t256cl.35█                                  │
└──────────────────────────────────────────────────────────────────┘
```

**User presses `S` (SELL command) — executes immediately:**
```
┌──────────────────────────────────────────────────────────────────┐
│ $ robin option sell 10 TSLA 1/12 256 call limit 0.35             │
│ Order submitted: SELL 10x TSLA 1/12 256C @ $0.35                 │
│ Order ID: xyz789abc123                                           │
│                                                                  │
│ QTY:10  SYMBOL:TSLA  EXP:1/12  STRIKE:256  TYPE:call  PRICE:0.35 │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                                            -- NORMAL --  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Example 5: Quick Jog Wheel Adjustment

**User presses `q` to start editing QTY:**
```
┌──────────────────────────────────────────────────────────────────┐
│ QTY:10  SYMBOL:TSLA  EXP:1/12  STRIKE:256  TYPE:call  PRICE:0.35 │
├──────────────────────────────────────────────────────────────────┤
│ [robin] q█                                                       │
└──────────────────────────────────────────────────────────────────┘
```

**User spins jog wheel CW (or presses `+` repeatedly) — QTY increments:**
```
┌──────────────────────────────────────────────────────────────────┐
│ QTY:15  SYMBOL:TSLA  EXP:1/12  STRIKE:256  TYPE:call  PRICE:0.35 │
├──────────────────────────────────────────────────────────────────┤
│ [robin] q█                                                       │
└──────────────────────────────────────────────────────────────────┘
```

**User presses `B` (BUY command) — commits QTY and executes:**
```
┌──────────────────────────────────────────────────────────────────┐
│ $ robin option buy 15 TSLA 1/12 256 call limit 0.35              │
│ Order submitted: BUY 15x TSLA 1/12 256C @ $0.35                  │
│                                                                  │
│ QTY:15  SYMBOL:TSLA  EXP:1/12  STRIKE:256  TYPE:call  PRICE:0.35 │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                                            -- NORMAL --  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Example 6: Minimal Input (Use Defaults)

**User just presses `S` (no variable changes):**
```
┌──────────────────────────────────────────────────────────────────┐
│ $ robin option sell 15 TSLA 1/12 256 call limit 0.35             │
│ Order submitted: SELL 15x TSLA 1/12 256C @ $0.35                 │
│                                                                  │
│ QTY:15  SYMBOL:TSLA  EXP:1/12  STRIKE:256  TYPE:call  PRICE:0.35 │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                                            -- NORMAL --  │
└──────────────────────────────────────────────────────────────────┘
```

All current variable values are used — no input required beyond the command key.

---

### Example 7: Toggling Enum with +/-

**User presses `c` (TYPE hotkey) then `+` to toggle:**
```
┌──────────────────────────────────────────────────────────────────┐
│ QTY:15  SYMBOL:TSLA  EXP:1/12  STRIKE:256  TYPE:put  PRICE:0.35  │
├──────────────────────────────────────────────────────────────────┤
│ [robin] c█                                                       │
└──────────────────────────────────────────────────────────────────┘
```

**User presses `S` — commits TYPE=put and sells:**
```
┌──────────────────────────────────────────────────────────────────┐
│ $ robin option sell 15 TSLA 1/12 256 put limit 0.35              │
│ Order submitted: SELL 15x TSLA 1/12 256P @ $0.35                 │
│                                                                  │
│ QTY:15  SYMBOL:TSLA  EXP:1/12  STRIKE:256  TYPE:put  PRICE:0.35  │
├──────────────────────────────────────────────────────────────────┤
│ [robin]                                            -- NORMAL --  │
└──────────────────────────────────────────────────────────────────┘
```

---

## SHELL Mode Session Examples

All REPL commands have direct SHELL equivalents:

### Stock Quote
```bash
$ mari sq TSLA
TSLA: $421.35 (+2.4%)
```

### Set Variables and Execute
```bash
$ mari set SYMBOL=IWM EXP=1/17 STRIKE=225 TYPE=put PRICE=0.45 QTY=5
$ mari b
Order submitted: BUY 5x IWM 1/17 225P @ $0.45

# Or inline:
$ mari b --symbol IWM --exp 1/17 --strike 225 --type put --price 0.45 --qty 5
```

### View/Modify Variables
```bash
$ mari vars
SYMBOL=IWM
EXP=1/17
STRIKE=225
TYPE=put
PRICE=0.45
QTY=5

$ mari set QTY=10
QTY=10
```

### Pipeline Composition
```bash
# Quote multiple symbols
$ echo -e "TSLA\nAAPL\nMSFT" | xargs -I{} mari sq {}

# Cancel all open orders
$ mari orders open --ids-only | xargs -I{} mari cancel {}

# Watch positions
$ watch -n 5 'mari positions'
```

### Interactive Invocation
```bash
# Start REPL mode explicitly
$ mari repl

# Start with preset variables
$ mari repl --symbol SPY --qty 10
```

---

## Built-in Commands (CMD mode)

| Command                  | Description                                    |
|--------------------------|------------------------------------------------|
| `:set VAR VALUE`         | Set variable (persisted to activity YAML)      |
| `:unset VAR`             | Reset variable to default                      |
| `:vars`                  | List all variables                             |
| `:reload`                | Reload activity files from disk                |
| `:q` / `:quit`           | Exit REPL                                      |
| `:help`                  | Show help                                      |

**Note:** Jog wheel and +/- are automatically bound to whichever variable is currently being edited (INPUT mode). There is no explicit `:jog` binding command.

---

## Project Structure

```
mari/
├── package.json
├── bin/
│   └── mari.js            # Entry point (global binary)
├── src/
│   ├── index.js            # Main dispatcher
│   ├── repl/
│   │   ├── index.js        # REPL loop
│   │   ├── modes.js        # Mode state machine (NORMAL, CMD, VAR_EDIT, LLM)
│   │   ├── statusbar.js    # Bottom statusbar rendering
│   │   ├── input.js        # Raw stdin handler
│   │   └── jog.js          # Jog wheel MIDI input handler
│   ├── shell/
│   │   └── index.js        # SHELL mode CLI parser
│   ├── config/
│   │   ├── loader.js       # YAML activity loader (reads activity/*.yml)
│   │   ├── schema.js       # Activity & variable schema validation
│   │   └── variables.js    # Variable type system (int, float, enum, string)
│   ├── commands/
│   │   ├── executor.js     # Shell command executor
│   │   └── store.js        # In-memory variable store
│   └── utils/
│       ├── template.js     # Variable substitution ($VAR, ${VAR})
│       └── validate.js     # Regex validation for variables
├── activity/               # Default activities (also ~/.config/mari/activity/)
│   ├── robin.yml           # Stock/options trading
│   ├── git.yml             # Git operations
│   └── docker.yml          # Container management
├── docs/
│   ├── CAD.md
│   ├── PROMPT.md
│   └── PLAN.md
└── test/
    └── jog-wheel.js
```

---

## Implementation Notes

### Activity Loading

On startup:
1. Read all `~/.config/mari/activity/*.yml` files
2. Parse and validate each activity against schema
3. Build activity list (sorted alphabetically by name)
4. Set first activity as current (or last-used if persisted)
5. Merge variables from current activity into runtime store

### Variable Type System

```typescript
interface VariableDefinition {
  type: 'int' | 'float' | 'string' | 'enum' | 'date';
  default?: any | string;              // value or "{{ js-expr }}"
  range?: [number, number] | string[] | string;  // bounds, enum values, or "YYYY-MM-DD..YYYY-MM-DD"
  step?: number;                        // for int/float/date (days)
  format?: string;                      // printf-style or date pattern
  hotkey?: string;                      // single char
  validate?: string;                    // regex pattern
}
```

**Default Resolution:**
1. If `default` is `"{{ ... }}"`, evaluate JS expression
2. Else if `default` is provided, use literal value
3. Else use type-specific default:
   - `int`: `0`
   - `float`: `0.0`
   - `string`: `""`
   - `enum`: first value in `range`
   - `date`: **current date** (`new Date()`)

**Adjustment Logic:**
- `+` key or jog CW: increment by `step` (or next enum value, or +N days)
- `-` key or jog CCW: decrement by `step` (or prev enum value, or -N days)
- Values are clamped to `range` bounds
- Enum values wrap around (last → first, first → last)
- Dates are clamped to range bounds (no wrap)

### Jog Wheel Integration

From `test/jog-wheel.js`, the jog wheel:
- Reads from `/dev/snd/midiC*` devices
- Sends MIDI CC messages: status `0xB0`, controller `0x0A`
- Value `0x01` = CW (clockwise), other = CCW (counter-clockwise)
- Can track velocity/speed for acceleration-based input

### CAD-Style Input Philosophy

From `docs/CAD.md`:
- Single-letter hotkeys trigger commands immediately
- Numeric input follows naturally (no field switching)
- Values appear in statusbar as typed
- `Enter` confirms, `Esc` cancels
- Support for expressions: `360/12`, `5*2.54`
- `Tab` now cycles through activities (not parameters)

### Tech Stack

- **Runtime**: Bun (for speed and native binary linking)
- **Config**: YAML (`js-yaml`)
- **Terminal UI**: Raw TTY mode via Node/Bun APIs
- **Installation**: `bun link` for global `mari` command

## References

- read `test/jog-wheel.js` to understand how we read the jog wheel input 
