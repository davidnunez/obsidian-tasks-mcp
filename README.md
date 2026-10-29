# obsidian-tasks-mcp

An MCP server that lets Claude read and edit tasks in an Obsidian vault. It understands the [Obsidian Tasks plugin](https://publish.obsidian.md/tasks/Introduction) format (`- [ ]` checkboxes, 📅 ⏳ 🛫 ✅ ❌ dates, `#tags`) and a subset of its query syntax.

## Why

I moved my task management from OmniFocus to Obsidian Tasks and didn't want to lose Claude as a task assistant. So I built this. The first version (query only) took about an hour and a half; the write tools came after, as I used it day to day.

It's built around my own vault conventions, so expect to adapt it.

## How it works

On each call it walks the vault, reads every `.md` file (skipping dot-folders and `node_modules`), and parses task lines. Nothing is cached or indexed. Write tools edit the markdown files in place.

## Tools

**Read**

- `query_tasks`: run a Tasks-style query, one filter per line. Supported filters:
  - `done`, `not done`, `cancelled`, `not cancelled`
  - `path includes <text>`, `path does not include <text>`
  - `tags include <tag>`, `tags do not include <tag>` (with `#` = exact match, without = substring)
  - `happens|starts|scheduled` + `before|after|on or before|on or after <date>`
  - `has|no` + `due|start|scheduled date`
  - `description includes <text>`
  - Dates: `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`
- `count_available_tasks`: count incomplete tasks that are workable today (no start/scheduled date, or one on or before today). Excludes `templates` paths and `someday` tags by default; optional breakdown.
- `find_duplicate_tasks`: find tasks with the same description in more than one file. Optionally include done tasks, or also match on due date.
- `task_health_check`: flag tasks missing a `#context/*` tag, malformed dates, very short descriptions, descriptions that start with a pronoun, lack an action verb, or lean on file context ("see below", "as discussed").

**Write**

- `complete_task`: `[ ]` → `[x]` plus `✅ YYYY-MM-DD`
- `cancel_task`: `[ ]` → `[-]` plus `❌ YYYY-MM-DD`
- `update_task_date`: set or change the due, scheduled or start date
- `add_tags`: append tags
- `remove_context_tags`: strip all `#context/*` tags
- `replace_context_tags`: swap all `#context/*` tags for new ones
- `consolidate_duplicate_task`: keep one copy of a duplicated task, cancel the rest with a `→ see [[file]]` link
- `append_daily_log`: add a `#logx` (or `#logx/<type>`) entry under the `Freewrite` heading of a daily note

Task-editing tools find a task by its 🆔 ID (6 characters; [Morgen](https://www.morgen.so) writes these) or by exact task text. `update_task_date` needs the ID.

## Requirements

- Node.js 18 or newer (I run it on 22)
- An Obsidian vault using the Tasks plugin format
- An MCP client such as Claude Desktop or Claude Code

## Setup

1. Clone and install:

   ```bash
   git clone https://github.com/davidnunez/obsidian-tasks-mcp.git
   cd obsidian-tasks-mcp
   npm install
   ```

2. **Point it at your vault** with environment variables, set in your MCP client config (step 3):

   | Variable | Required | Default | Meaning |
   |----------|----------|---------|---------|
   | `OBSIDIAN_VAULT_PATH` | yes | none | Absolute path to your vault. The server exits with an error if it's unset. |
   | `OBSIDIAN_DAILY_NOTES_DIR` | no | `Calendar/Days` | Daily notes folder, relative to the vault (an absolute path also works). |

   `append_daily_log` expects daily notes at `<daily notes dir>/YYYY-MM-DD.md` with a `# Freewrite` or `## Freewrite` heading.

3. Add it to your MCP client. For Claude Desktop (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "obsidian-tasks": {
         "command": "node",
         "args": ["/absolute/path/to/obsidian-tasks-mcp/index.js"],
         "env": {
           "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault",
           "OBSIDIAN_DAILY_NOTES_DIR": "Calendar/Days"
         }
       }
     }
   }
   ```

   For Claude Code: `claude mcp add obsidian-tasks -e OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault -- node /absolute/path/to/obsidian-tasks-mcp/index.js`

## Caveats

- Write tools change your vault files directly. There's no undo beyond whatever backup or sync you already have.
- No tests.
- The defaults (`#context/*` tags, the `someday` exclusion, the log types) reflect my own setup.

---

Not maintained — provided as-is. Issues and pull requests are closed.
