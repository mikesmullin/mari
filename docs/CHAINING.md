# PLAN_X: Command Output Chaining

## Problem Statement

Mari excels at:
- ✅ Executing commands quickly (hotkey-driven)
- ✅ Having LLM read screen for context (`$_BUFFER`)

But the UX for **chaining command output as input** is not yet satisfying:
- Taking the OUTPUT of the last command and using it as INPUT to the next action
- Whether that action is a script, another command, or an LLM evaluation

---

# The Decision — Activity-Controlled LLM Context

## Restatement of the Plan

**Core Insight**: Let the activity YAML define variables that get injected into the LLM prompt. This gives each activity full control over:

1. **How context is rendered** — the activity controls what the LLM "sees"
2. **Where outputs should go** — file paths, patterns, conventions are in the prompt
3. **What actions are available** — the LLM is taught activity-specific actions

**Key Mechanism**:
- Activity defines a variable (e.g., `$LLM_CONTEXT`) containing a multi-line template
- This template is auto-prepended to `$_BUFFER` when sent to LLM shell
- The template can include `$_SCREEN` (the rounds array) at any position
- Result: activity has strict power over the system prompt

**Why This Works**:
- LLM knows where to target outputs for any item (even in parallel)
- Opens up variety of actions — LLM can be taught to do anything
- LLM executes actions via tool calls (keeping Mari simple)
- Activity-agnostic: each activity defines its own conventions

---

## Proposed Implementation

### Variable Names

`llm_context` is an Activity-scoped 
Multi-line template 
injected into LLM prompt 
(its value contains the root-most template)

but from within that root-most template, 
we can reference the following variables
(and they will be resolved at LLM execution time)

| Variable | Scope | Description |
|----------|-------|-------------|
| `$_SCREEN` | Global | Content of the rounds array (what's on screen) |
| `$_BUFFER` | Global | Full buffer.log contents (reconstructed per LLM exec) |
| `$_LLM_PREPEND` | Command | Per-command context, resolved inside `llm_context` |

### Activity YAML Example

```yaml
# activity/discord.yml
name: discord
variables: 
  llm_context: |
    # Discord Activity Context
    
    You are operating in the Discord activity. When processing items:

    ## File Locations
    - Items are stored at: /home/user/.discord/items/
    - Filename pattern: <id>.yml (where <id> is the 6-char hash in brackets)
    - Example: item [abc123] → /home/user/.discord/items/abc123.yml
    
    ## Available Actions
    When you need to modify an item, output a tool call:
    - merge_yaml(file_path, yaml_data) — deep merge into target file
    - read_yaml(file_path) — read current file contents
    
    ## Additional Instructions
    $_LLM_PREPEND

    ## Current Screen
    $_SCREEN

hotkeys:
  l: discord-chat list
  # ...
```

### Workflow: Single-Item Refinement

```
1. User: tabs to `discord` activity (in NORMAL mode by default)

2. User: presses `l` hotkey
   Mari: runs `discord-chat list`, shows items on screen
   (now the list is in $_BUFFER)
   
3. User: presses `@` to enter LLM mode
   User: types `prioritize item 3`
   
4. Mari: scans input, matches `prioriti[sz]e` skill pattern
   Mari: constructs buffer.log as:
     - llm_context (with $_LLM_PREPEND from matched skill, and $_SCREEN embedded)
     - user's input
   
5. LLM: receives prompt including:
     - skill instructions: "Extract ID from [abc123] format, call merge_yaml(...)"
     - list output showing [abc123] Priority: low
   
6. LLM: calls tool to apply change:
     merge_yaml("/home/user/.discord/items/abc123.yml", {priority: 8})
   
7. LLM: responds with summary of changes
   Mari: displays response on screen
```

### Workflow: Multi-Item Parallel Refinement

```
1. User: tabs to `discord` activity (in NORMAL mode by default)

2. User: presses `l` hotkey
   Mari: runs `discord-chat list`, shows items on screen
   (now the list is in $_BUFFER)
   
3. User: presses `@` to enter LLM mode
   User: types `prioritize items 1-3`
   
4. Mari: scans input, matches `prioriti[sz]e` skill pattern
   Mari: constructs buffer.log with llm_context + skill instructions
   
5. LLM: receives context including:
     - skill instructions about file patterns and merge_yaml
     - list showing [abc123], [def456], [ghi789]
   
6. LLM: calls tools in parallel (or sequentially):
     merge_yaml("/home/user/.discord/items/abc123.yml", {priority: 8})
     merge_yaml("/home/user/.discord/items/def456.yml", {priority: 6})
     merge_yaml("/home/user/.discord/items/ghi789.yml", {priority: 4})
   
7. LLM: responds with summary of changes
   Mari: displays response on screen
```

### buffer.log Reconstruction Logic

```javascript
// In src/repl/buffer.js or src/shell/index.js

function constructLLMBuffer(activity, rounds) {
  const screen = rounds.map(r => r.toString()).join('\n');
  
  // Get activity's llm_context, expand $_SCREEN within it
  let context = activity.variables?.llm_context || '$_SCREEN';
  context = context.replace('$_SCREEN', screen);
  
  // Expand other activity variables
  context = expandVariables(context, activity.variables);
  
  return context;
}
```

### Additionally: Per-Command Context Injection

For common action patterns, each command can optionally define additional context via `llm_prepend`. This value becomes available as `$_LLM_PREPEND` inside `$LLM_CONTEXT`:

```yaml
# activity/discord.yml
name: discord
variables:
  llm_context: |
    # Discord Activity Context
    $_LLM_PREPEND
    
    ## File Locations
    - Items are stored at: /home/user/.discord/items/
    - Example: item [abc123] → /home/user/.discord/items/abc123.yml
    
    ## Current Screen
    $_SCREEN

commands:
  l:
    shell: discord-chat list
  r:
    shell: discord-chat refine
    llm_prepend: |
      ## Refinement Mode
      When refining items, use merge_yaml(path, data) to update.
      Extract the ID from [abc123] format and target /home/user/.discord/items/<id>.yml
  p:
    shell: discord-chat prioritize
    llm_prepend: |
      ## Priority Mode  
      Set priority 1-10. Use merge_yaml with {priority: N}.
```

**How it works**:
1. User presses `r` hotkey
2. Mari resolves `$_LLM_PREPEND` from the command's `llm_prepend` value
3. Mari expands `$LLM_CONTEXT`, which contains `$_LLM_PREPEND` at the position the activity author chose
4. LLM receives command-specific instructions embedded within activity context

**Why `$_LLM_PREPEND` inside `$LLM_CONTEXT`**:
- Activity author controls exactly where command-specific context appears
- Can put it at top, middle, or omit entirely
- More flexible than always prepending

**Use cases**:
- Different merge strategies per command
- Command-specific tool hints
- Action templates ("always use this format for priority changes")

---

### Pattern-Based Context Injection (LLM Mode)

**The Gap**: Per-command `llm_prepend` is only useful when the command itself invokes `subd` or otherwise consumes `$_BUFFER`. Most commands don't — they're regular shell commands. The typical LLM invocation happens in **LLM mode**, where the user types arbitrary requests.

**Solution**: Define patterns in the activity YAML that match against user input in LLM mode. When the user submits input that matches a pattern, the associated `llm_prepend` gets included in `$_LLM_PREPEND`.

This is similar to how `SKILLS.md` files work by convention — matching on keywords/intents to provide task-specific instructions.

```yaml
# activity/discord.yml
name: discord
variables:
  llm_context: |
    # Discord Activity Context
    $_LLM_PREPEND
    
    ## File Locations
    - Items are stored at: /home/user/.discord/items/
    
    ## Current Screen
    $_SCREEN

# Pattern-based injection for LLM mode
skills:
  - pattern: 'prioriti[sz]e'
    llm_prepend: |
      ## Priority Task
      When prioritizing items:
      - Use scale 1-10 (10 = highest)
      - Extract the 6-char ID from the [abc123] format in the list
      - Call merge_yaml(/home/user/.discord/items/<id>.yml, {priority: N})
      
  - pattern: 'summariz|recap|overview'
    llm_prepend: |
      ## Summary Task
      Provide a concise summary of the listed items.
      Group by priority or topic as appropriate.
      
  - pattern: 'delete|remove|archive'
    llm_prepend: |
      ## Deletion Task
      To archive an item, call: discord-chat archive <id>
      Confirm with user before destructive actions.
```

**How it works**:
1. User enters LLM mode (`@`)
2. User types: `prioritize items 2 and 5`
3. Mari scans input against `skills[].pattern` (regex)
4. Match found: `prioriti[sz]e` → its `llm_prepend` is added to `$_LLM_PREPEND`
5. `llm_context` is expanded with the matched skill instructions
6. LLM receives task-specific guidance embedded in context

**Multiple matches**:
- If input matches multiple patterns, all matching `llm_prepend` values are concatenated
- Order: first match first (or by specificity?)

**Pattern syntax**:
- Regex by default (case-insensitive)
- Could support simple glob/keyword matching as shorthand

**Why this works**:
- Covers the common case: LLM mode with arbitrary user input
- Activity author defines "skills" the LLM can perform
- No change needed to how user interacts — just type naturally
- Skills are discoverable (could list them with a command)

**Comparison**:

| Injection Method | Trigger | Use Case |
|------------------|---------|----------|
| Per-command `llm_prepend` | Hotkey press | Commands that invoke subd |
| Pattern-based `skills` | User input match | LLM mode with free-form input |

Both populate `$_LLM_PREPEND`, so they compose naturally.

---

## Resolved Questions

### Variable Expansion

1. **When does `$LLM_CONTEXT` get expanded?**
   → At LLM exec time, so `$_SCREEN` reflects current rounds.

2. **Can `$LLM_CONTEXT` reference other activity variables?**
   → Yes. All activity variable values are resolved just prior to writing `buffer.log`. For example, `robin` activity's `$QTY` will be resolved at LLM exec time.

3. **What format is `$_SCREEN`?**
   → Formatted as rounds currently appear in `buffer.log` (command + output pairs).

### Tool Calls

4. **Who executes the tool calls?**
   → `subd` (the LLM shell). Mari doesn't have tools in this sense.

5. **What tools should be universally available?**
   → Defined per-activity in `$LLM_CONTEXT`. User configures what tools/actions the LLM can use.

6. **Should tool calls be confirmed?**
   → N/A. Mari doesn't execute tools; `subd` does.

### Parallel Execution

7-9. **Orchestrator and subagent behavior?**
   → Out of scope for Mari. The orchestrator decides how to pass context, extract IDs, and run parallel jobs.

### Activity Portability

10. **Minimal `$LLM_CONTEXT` for a new activity?**
    → Defaults to just `$_SCREEN` if not specified.

11. **Activities without file-based storage?**
    → Not a concern. User defines appropriate actions in `$LLM_CONTEXT` (e.g., `git commit`, `POST to API`).

12. **Library of common action patterns?**
    → See "Per-Command Context Injection" above for how hotkey-specific `llm_prepend` enables this.