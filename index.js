#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { scanMarkdownFiles } from './fileScanner.js';
import { parseTasksFromFiles } from './taskParser.js';
import { executeQuery } from './queryParser.js';

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH
  ? path.resolve(process.env.OBSIDIAN_VAULT_PATH)
  : undefined;
if (!VAULT_PATH) {
  console.error(
    'obsidian-tasks-mcp: OBSIDIAN_VAULT_PATH is not set. ' +
    'Set it to the absolute path of your Obsidian vault.'
  );
  process.exit(1);
}
const DAILY_NOTES_DIR = process.env.OBSIDIAN_DAILY_NOTES_DIR || path.join('Calendar', 'Days');
const DAILY_NOTES_PATH = path.resolve(VAULT_PATH, DAILY_NOTES_DIR);

// Valid log types
const VALID_LOG_TYPES = [
  'logx',
  'logx/moment',
  'logx/outcome',
  'logx/session',
  'logx/insight',
  'logx/wilt',
  'logx/improvement',
  'logx/high',
  'logx/low',
  'logx/thought',
  'logx/life',
  'logx/artifact',
  'logx/decision',
  'logx/meal',
  'logx/handoff',
  'logx/session-end',
  'logx/journal'
];

const server = new Server(
  {
    name: 'obsidian-tasks-mcp',
    version: '1.3.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'query_tasks',
        description:
          'Query tasks from Obsidian using Tasks plugin query syntax. ' +
          'Supports filters like: done, not done, happens before [date], ' +
          'starts before/after [date], scheduled before/after [date], ' +
          'has start date, no scheduled date, ' +
          'path includes [string], tags include [tag]. ' +
          'Tag matching: with # = exact match (e.g., "#context/someday"), without # = substring match (e.g., "someday" matches any tag containing "someday")',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Tasks query in Tasks plugin syntax. Each line is a filter. ' +
                'Examples: "not done", "happens on or before today", ' +
                '"path does not include templates"',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'append_daily_log',
        description:
          'Append a #logx entry to today\'s daily note in the Freewrite section. ' +
          'Valid log types: moment, outcome, session, insight, wilt, improvement, ' +
          'high, low, thought, life, artifact, decision, meal, handoff, session-end, journal. ' +
          'Use just "logx" for simple life moments.',
        inputSchema: {
          type: 'object',
          properties: {
            log_type: {
              type: 'string',
              description:
                'The log type (without #). Examples: "logx/moment", "logx/high", "logx". ' +
                'Valid types: moment, outcome, session, insight, wilt, improvement, ' +
                'high, low, thought, life, artifact, decision, meal, handoff, session-end, journal',
            },
            content: {
              type: 'string',
              description: 'The log entry content',
            },
            timestamp: {
              type: 'string',
              description:
                'Optional timestamp in "YYYY-MM-DD HH:MM" format. ' +
                'If not provided, uses current time.',
            },
            date: {
              type: 'string',
              description:
                'Optional date for the daily note in "YYYY-MM-DD" format. ' +
                'If not provided, uses today.',
            },
          },
          required: ['log_type', 'content'],
        },
      },
      {
        name: 'complete_task',
        description:
          'Mark a task as complete in Obsidian. Finds the task by task ID (preferred) or exact text match, ' +
          'changes [ ] to [x], and appends a completion date (✅ YYYY-MM-DD).',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description:
                'The 6-character task ID (from Morgen). Example: "M7TEvZ". Preferred over task_text.',
            },
            task_text: {
              type: 'string',
              description:
                'The exact text of the task to complete (without the checkbox). ' +
                'Example: "Buy groceries" or "Buy groceries #context/errands 📅 2025-12-27". ' +
                'Use task_id instead when available.',
            },
          },
        },
      },
      {
        name: 'cancel_task',
        description:
          'Mark a task as cancelled in Obsidian. Finds the task by task ID (preferred) or exact text match, ' +
          'changes [ ] to [-], and appends a cancellation date (❌ YYYY-MM-DD).',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description:
                'The 6-character task ID (from Morgen). Example: "M7TEvZ". Preferred over task_text.',
            },
            task_text: {
              type: 'string',
              description:
                'The exact text of the task to cancel (without the checkbox). ' +
                'Example: "Buy groceries" or "Buy groceries #context/errands 📅 2025-12-27". ' +
                'Use task_id instead when available.',
            },
          },
        },
      },
      {
        name: 'remove_context_tags',
        description:
          'Remove all #context/* tags from a task. Finds the task by task ID (preferred) or exact text match ' +
          'and strips any tags matching #context/...',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description:
                'The 6-character task ID (from Morgen). Example: "M7TEvZ". Preferred over task_text.',
            },
            task_text: {
              type: 'string',
              description:
                'The exact text of the task (without the checkbox). ' +
                'Example: "Buy groceries #context/errands 📅 2025-12-27". ' +
                'Use task_id instead when available.',
            },
          },
        },
      },
      {
        name: 'add_tags',
        description:
          'Add one or more tags to a task. Finds the task by task ID (preferred) or exact text match ' +
          'and appends the specified tags.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description:
                'The 6-character task ID (from Morgen). Example: "M7TEvZ". Preferred over task_text.',
            },
            task_text: {
              type: 'string',
              description:
                'The exact text of the task (without the checkbox). ' +
                'Example: "Buy groceries 📅 2025-12-27". ' +
                'Use task_id instead when available.',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Array of tags to add (with or without #). ' +
                'Example: ["#context/deep", "#project/90day"]',
            },
          },
          required: ['tags'],
        },
      },
      {
        name: 'replace_context_tags',
        description:
          'Replace all #context/* tags with new tags in one operation. ' +
          'Finds the task by task ID (preferred) or exact text match, removes all #context/... tags, ' +
          'and appends the new tags.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description:
                'The 6-character task ID (from Morgen). Example: "M7TEvZ". Preferred over task_text.',
            },
            task_text: {
              type: 'string',
              description:
                'The exact text of the task (without the checkbox). ' +
                'Example: "Buy groceries #context/errands 📅 2025-12-27". ' +
                'Use task_id instead when available.',
            },
            new_tags: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Array of new tags to add after removing context tags. ' +
                'Example: ["#context/shallow", "#context/errands"]',
            },
          },
          required: ['new_tags'],
        },
      },
      {
        name: 'find_duplicate_tasks',
        description:
          'Scan vault for duplicate tasks - tasks with identical or very similar descriptions ' +
          'appearing in multiple files. Helps identify data integrity issues.',
        inputSchema: {
          type: 'object',
          properties: {
            include_done: {
              type: 'boolean',
              description:
                'Include completed/cancelled tasks in duplicate detection. ' +
                'Default: false (only scan incomplete tasks).',
            },
            strict_match: {
              type: 'boolean',
              description:
                'Include due date in duplicate matching. When true, tasks with same description ' +
                'but different due dates are NOT considered duplicates. ' +
                'Default: false (only match on description text).',
            },
          },
        },
      },
      {
        name: 'consolidate_duplicate_task',
        description:
          'Cancel all but one instance of a duplicated task, keeping one as canonical. ' +
          'Cancelled instances get a link to the canonical file. ' +
          'Use after find_duplicate_tasks to clean up duplicates.',
        inputSchema: {
          type: 'object',
          properties: {
            task_description: {
              type: 'string',
              description:
                'The task description to consolidate (case-insensitive match). ' +
                'Example: "renew library card"',
            },
            canonical_file_path: {
              type: 'string',
              description:
                'Relative path to the file that should keep the canonical task. ' +
                'Example: "Projects/Home.md"',
            },
          },
          required: ['task_description', 'canonical_file_path'],
        },
      },
      {
        name: 'task_health_check',
        description:
          'Scan vault for task data quality issues. Checks for: missing context tags, ' +
          'malformed dates, and stand-alone clarity issues (vague descriptions, ' +
          'pronoun starters, missing action verbs, file-context references).',
        inputSchema: {
          type: 'object',
          properties: {
            include_done: {
              type: 'boolean',
              description:
                'Include completed/cancelled tasks in health check. ' +
                'Default: false (only scan incomplete tasks).',
            },
            max_examples: {
              type: 'number',
              description:
                'Maximum examples to show per issue category. Default: 10.',
            },
          },
        },
      },
      {
        name: 'update_task_date',
        description:
          'Update a date on a task (due, scheduled, or start). Finds the task by its Morgen ID (🆔) ' +
          'and updates or adds the specified date. Date emojis: 📅 (due), ⏳ (scheduled), 🛫 (start).',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description:
                'The 6-character task ID (from Morgen). Example: "M7TEvZ". Required.',
            },
            new_date: {
              type: 'string',
              description:
                'The new date in YYYY-MM-DD format. Example: "2026-01-25".',
            },
            date_type: {
              type: 'string',
              enum: ['due', 'scheduled', 'start'],
              description:
                'Which date to update: "due" (📅), "scheduled" (⏳), or "start" (🛫). ' +
                'Default: "due".',
            },
          },
          required: ['task_id', 'new_date'],
        },
      },
      {
        name: 'count_available_tasks',
        description:
          'Count tasks that are "available" to work on right now. A task is available if it is incomplete (not done/cancelled) AND: ' +
          '(1) has no start date (🛫) and no scheduled date (⏳), OR ' +
          '(2) has a start date on or before today, OR ' +
          '(3) has a scheduled date on or before today. ' +
          'By default, excludes tasks in "templates" paths and tasks tagged #context/someday.',
        inputSchema: {
          type: 'object',
          properties: {
            path_includes: {
              type: 'string',
              description:
                'Optional: Only count tasks in files whose path includes this string. ' +
                'Example: "Projects" or "Areas/Work".',
            },
            path_excludes: {
              type: 'string',
              description:
                'Exclude tasks in files whose path includes this string. ' +
                'Default: "templates".',
            },
            tag_includes: {
              type: 'string',
              description:
                'Optional: Only count tasks that have this tag. ' +
                'Example: "#context/deep" or "#project/90day". ' +
                'Tag matching: with # = exact match (e.g., "#context/deep"), without # = substring match (e.g., "deep" matches any tag containing "deep")',
            },
            tag_excludes: {
              type: 'string',
              description:
                'Exclude tasks that have this tag. ' +
                'Default: "#context/someday". ' +
                'Tag matching: with # = exact match (e.g., "#context/someday"), without # = substring match (e.g., "someday" matches "#context/someday", "#context/meta/someday", etc.)',
            },
            show_breakdown: {
              type: 'boolean',
              description:
                'If true, show a breakdown by availability reason. Default: false.',
            },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'query_tasks') {
    const query = args?.query || '';

    try {
      // Scan files and parse tasks
      const files = await scanMarkdownFiles(VAULT_PATH);
      const tasks = parseTasksFromFiles(files);

      // Execute the query
      const { results, unrecognized } = executeQuery(query, tasks);

      // Format output
      let output = '';

      if (unrecognized.length > 0) {
        output += `⚠️ Unrecognized filters (ignored): ${unrecognized.join(', ')}\n\n`;
      }

      output += `Found ${results.length} tasks:\n\n`;

      for (const task of results.slice(0, 50)) {
        const checkbox = task.status === 'done' ? '[x]' : task.status === 'cancelled' ? '[-]' : '[ ]';
        const dueStr = task.dueDate ? ` 📅 ${task.dueDate}` : '';
        const tagsStr = task.tags.length > 0 ? ` ${task.tags.join(' ')}` : '';
        const idStr = task.taskId ? ` 🆔 ${task.taskId}` : '';
        const pathShort = task.path.replace(VAULT_PATH + '/', '');

        output += `- ${checkbox} ${task.description}${dueStr}${tagsStr}${idStr}\n`;
        output += `  📁 ${pathShort}\n\n`;
      }

      if (results.length > 50) {
        output += `\n... and ${results.length - 50} more tasks (showing first 50)\n`;
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === 'append_daily_log') {
    const { log_type, content, timestamp, date } = args || {};

    try {
      // Validate log type
      if (!VALID_LOG_TYPES.includes(log_type)) {
        return {
          content: [{
            type: 'text',
            text: `Invalid log type: ${log_type}. Valid types: ${VALID_LOG_TYPES.join(', ')}`,
          }],
          isError: true,
        };
      }

      // Determine the date for the daily note
      const now = new Date();
      // Using 'en-CA' locale because it returns YYYY-MM-DD format (ISO 8601)
      // This also fixes timezone issues - toISOString() returns UTC which can be a day ahead
      const localDate = now.toLocaleDateString('en-CA');
      const localTime = now.toTimeString().slice(0, 5);
      const targetDate = date || localDate;
      
      // Generate timestamp if not provided
      const logTimestamp = timestamp || `${localDate} ${localTime}`;

      // Build the daily note path
      const dailyNotePath = path.join(DAILY_NOTES_PATH, `${targetDate}.md`);

      // Check if daily note exists
      let fileContent;
      try {
        fileContent = await fs.readFile(dailyNotePath, 'utf-8');
      } catch (err) {
        if (err.code === 'ENOENT') {
          return {
            content: [{
              type: 'text',
              text: `Daily note not found: ${targetDate}.md. Please create it first.`,
            }],
            isError: true,
          };
        }
        throw err;
      }

      // Find the Freewrite section
      const freewriteMatch = fileContent.match(/^#{1,2} Freewrite\s*$/m);
      if (!freewriteMatch) {
        return {
          content: [{
            type: 'text',
            text: `Could not find "# Freewrite" or "## Freewrite" section in ${targetDate}.md`,
          }],
          isError: true,
        };
      }

      // Build the log entry
      const logEntry = `- \`${logTimestamp}\`: #${log_type} ${content}`;

      // Find where Freewrite section ends (next heading or EOF)
      const freewriteIndex = freewriteMatch.index + freewriteMatch[0].length;
      const afterFreewrite = fileContent.slice(freewriteIndex);
      
      // Find next heading (if any)
      const nextHeadingMatch = afterFreewrite.match(/^#+ /m);
      
      let insertPosition;
      if (nextHeadingMatch) {
        // Insert before the next heading
        insertPosition = freewriteIndex + nextHeadingMatch.index;
      } else {
        // Append at end of file
        insertPosition = fileContent.length;
      }

      // Get content before and after insert point
      const before = fileContent.slice(0, insertPosition).trimEnd();
      const after = fileContent.slice(insertPosition);

      // Build new content with proper spacing
      const newContent = before + '\n' + logEntry + '\n' + after;

      // Write the file
      await fs.writeFile(dailyNotePath, newContent, 'utf-8');

      return {
        content: [{
          type: 'text',
          text: `✅ Logged to ${targetDate}.md:\n${logEntry}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error.message}`,
        }],
        isError: true,
      };
    }
  }

  if (name === 'complete_task' || name === 'cancel_task') {
    const { task_id, task_text } = args || {};
    const isComplete = name === 'complete_task';
    const newCheckbox = isComplete ? '[x]' : '[-]';
    const dateEmoji = isComplete ? '✅' : '❌';
    const actionVerb = isComplete ? 'Completed' : 'Cancelled';

    try {
      if ((!task_id || task_id.trim() === '') && (!task_text || task_text.trim() === '')) {
        return {
          content: [{ type: 'text', text: 'Error: Either task_id or task_text is required' }],
          isError: true,
        };
      }

      // Scan all markdown files
      const files = await scanMarkdownFiles(VAULT_PATH);

      // Today's date for the completion/cancellation stamp
      // Using 'en-CA' locale because it returns YYYY-MM-DD format (ISO 8601)
      // This also fixes timezone issues - toISOString() returns UTC which can be a day ahead
      const today = new Date().toLocaleDateString('en-CA');
      const dateStamp = ` ${dateEmoji} ${today}`;

      let found = false;
      let matchedFile = '';
      let matchedTaskDesc = '';

      // If task_id provided, search by ID (preferred method)
      if (task_id && task_id.trim() !== '') {
        const idPattern = new RegExp(
          `^(\\s*- \\[ \\] )(.*)🆔\\s*${task_id}\\s*$`,
          'm'
        );

        for (const file of files) {
          const match = file.content.match(idPattern);
          if (match) {
            // Replace the checkbox and append date stamp
            const newTaskLine = match[0]
              .replace('- [ ] ', `- ${newCheckbox} `)
              .trimEnd() + dateStamp;

            const newContent = file.content.replace(match[0], newTaskLine);
            await fs.writeFile(file.path, newContent, 'utf-8');

            found = true;
            matchedFile = file.path.replace(VAULT_PATH + '/', '');
            matchedTaskDesc = match[2].trim();
            break;
          }
        }

        if (!found) {
          return {
            content: [{
              type: 'text',
              text: `Could not find incomplete task with ID: "${task_id}"`,
            }],
            isError: true,
          };
        }
      } else {
        // Fall back to task_text matching
        const escapedTaskText = task_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Pattern to match an incomplete task with this exact text
        // Matches: - [ ] <task_text> (with possible whitespace variations)
        const taskPattern = new RegExp(
          `^(\\s*- \\[ \\] )${escapedTaskText}\\s*$`,
          'm'
        );

        for (const file of files) {
          const match = file.content.match(taskPattern);
          if (match) {
            // Replace the checkbox and append date stamp
            const newTaskLine = match[0]
              .replace('- [ ] ', `- ${newCheckbox} `)
              .trimEnd() + dateStamp;

            const newContent = file.content.replace(match[0], newTaskLine);
            await fs.writeFile(file.path, newContent, 'utf-8');

            found = true;
            matchedFile = file.path.replace(VAULT_PATH + '/', '');
            matchedTaskDesc = task_text;
            break;
          }
        }

        if (!found) {
          return {
            content: [{
              type: 'text',
              text: `Could not find incomplete task: "${task_text}"\n\nMake sure the task text matches exactly (including any tags, dates, etc).`,
            }],
            isError: true,
          };
        }
      }

      const displayText = task_id ? `[${task_id}] ${matchedTaskDesc}` : task_text;
      return {
        content: [{
          type: 'text',
          text: `${dateEmoji} ${actionVerb}: ${displayText}\n📁 ${matchedFile}`,
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'remove_context_tags') {
    const { task_id, task_text } = args || {};

    try {
      if ((!task_id || task_id.trim() === '') && (!task_text || task_text.trim() === '')) {
        return {
          content: [{ type: 'text', text: 'Error: Either task_id or task_text is required' }],
          isError: true,
        };
      }

      const files = await scanMarkdownFiles(VAULT_PATH);
      let found = false;
      let matchedFile = '';
      let newTaskText = '';

      // If task_id provided, search by ID (preferred method)
      if (task_id && task_id.trim() !== '') {
        const idPattern = new RegExp(
          `^(\\s*- \\[.\\] )(.*)🆔\\s*${task_id}\\s*$`,
          'm'
        );

        for (const file of files) {
          const match = file.content.match(idPattern);
          if (match) {
            const fullLine = match[0];
            const prefix = match[1];
            const taskContent = fullLine.slice(prefix.length);

            // Remove all #context/* tags
            const cleanedContent = taskContent
              .replace(/#context\/[^\s]*/g, '')
              .replace(/\s+/g, ' ')
              .trim();

            const newLine = prefix + cleanedContent;
            const newContent = file.content.replace(fullLine, newLine);
            await fs.writeFile(file.path, newContent, 'utf-8');

            found = true;
            matchedFile = file.path.replace(VAULT_PATH + '/', '');
            newTaskText = cleanedContent;
            break;
          }
        }

        if (!found) {
          return {
            content: [{
              type: 'text',
              text: `Could not find task with ID: "${task_id}"`,
            }],
            isError: true,
          };
        }
      } else {
        // Fall back to task_text matching
        const escapedTaskText = task_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const taskPattern = new RegExp(
          `^(\\s*- \\[.\\] )${escapedTaskText}\\s*$`,
          'm'
        );

        for (const file of files) {
          const match = file.content.match(taskPattern);
          if (match) {
            const fullLine = match[0];
            const prefix = match[1];
            const taskContent = fullLine.slice(prefix.length);

            // Remove all #context/* tags
            const cleanedContent = taskContent
              .replace(/#context\/[^\s]*/g, '')
              .replace(/\s+/g, ' ')
              .trim();

            const newLine = prefix + cleanedContent;
            const newContent = file.content.replace(fullLine, newLine);
            await fs.writeFile(file.path, newContent, 'utf-8');

            found = true;
            matchedFile = file.path.replace(VAULT_PATH + '/', '');
            newTaskText = cleanedContent;
            break;
          }
        }

        if (!found) {
          return {
            content: [{
              type: 'text',
              text: `Could not find task: "${task_text}"\n\nMake sure the task text matches exactly.`,
            }],
            isError: true,
          };
        }
      }

      return {
        content: [{
          type: 'text',
          text: `🧹 Removed context tags\n📁 ${matchedFile}\n\nNew task: ${newTaskText}`,
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'add_tags') {
    const { task_id, task_text, tags } = args || {};

    try {
      if ((!task_id || task_id.trim() === '') && (!task_text || task_text.trim() === '')) {
        return {
          content: [{ type: 'text', text: 'Error: Either task_id or task_text is required' }],
          isError: true,
        };
      }
      if (!tags || !Array.isArray(tags) || tags.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: tags array is required and must not be empty' }],
          isError: true,
        };
      }

      // Normalize tags to ensure they start with #
      const normalizedTags = tags.map(t => t.startsWith('#') ? t : `#${t}`);

      const files = await scanMarkdownFiles(VAULT_PATH);
      let found = false;
      let matchedFile = '';
      let newTaskText = '';

      // If task_id provided, search by ID (preferred method)
      if (task_id && task_id.trim() !== '') {
        const idPattern = new RegExp(
          `^(\\s*- \\[.\\] )(.*)🆔\\s*${task_id}\\s*$`,
          'm'
        );

        for (const file of files) {
          const match = file.content.match(idPattern);
          if (match) {
            const fullLine = match[0].trimEnd();
            // Insert tags before the ID
            const idIndex = fullLine.lastIndexOf('🆔');
            const beforeId = fullLine.slice(0, idIndex).trimEnd();
            const idPart = fullLine.slice(idIndex);
            const newLine = beforeId + ' ' + normalizedTags.join(' ') + ' ' + idPart;
            const newContent = file.content.replace(match[0], newLine);
            await fs.writeFile(file.path, newContent, 'utf-8');

            found = true;
            matchedFile = file.path.replace(VAULT_PATH + '/', '');
            newTaskText = newLine.replace(/^\s*- \[.\] /, '');
            break;
          }
        }

        if (!found) {
          return {
            content: [{
              type: 'text',
              text: `Could not find task with ID: "${task_id}"`,
            }],
            isError: true,
          };
        }
      } else {
        // Fall back to task_text matching
        const escapedTaskText = task_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const taskPattern = new RegExp(
          `^(\\s*- \\[.\\] )${escapedTaskText}\\s*$`,
          'm'
        );

        for (const file of files) {
          const match = file.content.match(taskPattern);
          if (match) {
            const fullLine = match[0].trimEnd();
            const newLine = fullLine + ' ' + normalizedTags.join(' ');
            const newContent = file.content.replace(match[0], newLine);
            await fs.writeFile(file.path, newContent, 'utf-8');

            found = true;
            matchedFile = file.path.replace(VAULT_PATH + '/', '');
            newTaskText = newLine.replace(/^\s*- \[.\] /, '');
            break;
          }
        }

        if (!found) {
          return {
            content: [{
              type: 'text',
              text: `Could not find task: "${task_text}"\n\nMake sure the task text matches exactly.`,
            }],
            isError: true,
          };
        }
      }

      return {
        content: [{
          type: 'text',
          text: `🏷️ Added tags: ${normalizedTags.join(' ')}\n📁 ${matchedFile}\n\nNew task: ${newTaskText}`,
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'replace_context_tags') {
    const { task_id, task_text, new_tags } = args || {};

    try {
      if ((!task_id || task_id.trim() === '') && (!task_text || task_text.trim() === '')) {
        return {
          content: [{ type: 'text', text: 'Error: Either task_id or task_text is required' }],
          isError: true,
        };
      }
      if (!new_tags || !Array.isArray(new_tags) || new_tags.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: new_tags array is required and must not be empty' }],
          isError: true,
        };
      }

      // Normalize tags to ensure they start with #
      const normalizedTags = new_tags.map(t => t.startsWith('#') ? t : `#${t}`);

      const files = await scanMarkdownFiles(VAULT_PATH);
      let found = false;
      let matchedFile = '';
      let oldTags = [];
      let newTaskText = '';

      // If task_id provided, search by ID (preferred method)
      if (task_id && task_id.trim() !== '') {
        const idPattern = new RegExp(
          `^(\\s*- \\[.\\] )(.*)🆔\\s*${task_id}\\s*$`,
          'm'
        );

        for (const file of files) {
          const match = file.content.match(idPattern);
          if (match) {
            const fullLine = match[0];
            const prefix = match[1];
            const taskContent = fullLine.slice(prefix.length);

            // Find old context tags for reporting
            const oldTagMatches = taskContent.match(/#context\/[^\s]*/g);
            oldTags = oldTagMatches || [];

            // Remove all #context/* tags
            const cleanedContent = taskContent
              .replace(/#context\/[^\s]*/g, '')
              .replace(/\s+/g, ' ')
              .trim();

            // For ID-based tasks, we need to insert tags before the ID
            const idIndex = cleanedContent.lastIndexOf('🆔');
            let newLine;
            if (idIndex !== -1) {
              const beforeId = cleanedContent.slice(0, idIndex).trimEnd();
              const idPart = cleanedContent.slice(idIndex);
              newLine = prefix + beforeId + ' ' + normalizedTags.join(' ') + ' ' + idPart;
              newTaskText = beforeId + ' ' + normalizedTags.join(' ') + ' ' + idPart;
            } else {
              newLine = prefix + cleanedContent + ' ' + normalizedTags.join(' ');
              newTaskText = cleanedContent + ' ' + normalizedTags.join(' ');
            }
            const newContent = file.content.replace(fullLine, newLine);
            await fs.writeFile(file.path, newContent, 'utf-8');

            found = true;
            matchedFile = file.path.replace(VAULT_PATH + '/', '');
            break;
          }
        }

        if (!found) {
          return {
            content: [{
              type: 'text',
              text: `Could not find task with ID: "${task_id}"`,
            }],
            isError: true,
          };
        }
      } else {
        // Fall back to task_text matching
        const escapedTaskText = task_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const taskPattern = new RegExp(
          `^(\\s*- \\[.\\] )${escapedTaskText}\\s*$`,
          'm'
        );

        for (const file of files) {
          const match = file.content.match(taskPattern);
          if (match) {
            const fullLine = match[0];
            const prefix = match[1];
            const taskContent = fullLine.slice(prefix.length);

            // Find old context tags for reporting
            const oldTagMatches = taskContent.match(/#context\/[^\s]*/g);
            oldTags = oldTagMatches || [];

            // Remove all #context/* tags
            const cleanedContent = taskContent
              .replace(/#context\/[^\s]*/g, '')
              .replace(/\s+/g, ' ')
              .trim();

            // Add new tags
            const newLine = prefix + cleanedContent + ' ' + normalizedTags.join(' ');
            const newContent = file.content.replace(fullLine, newLine);
            await fs.writeFile(file.path, newContent, 'utf-8');

            found = true;
            matchedFile = file.path.replace(VAULT_PATH + '/', '');
            newTaskText = cleanedContent + ' ' + normalizedTags.join(' ');
            break;
          }
        }

        if (!found) {
          return {
            content: [{
              type: 'text',
              text: `Could not find task: "${task_text}"\n\nMake sure the task text matches exactly.`,
            }],
            isError: true,
          };
        }
      }

      return {
        content: [{
          type: 'text',
          text: `🔄 Replaced context tags\n📁 ${matchedFile}\n\nRemoved: ${oldTags.join(' ') || '(none)'}\nAdded: ${normalizedTags.join(' ')}\n\nNew task: ${newTaskText}`,
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'find_duplicate_tasks') {
    const { include_done, strict_match } = args || {};

    try {
      // Scan all markdown files
      const files = await scanMarkdownFiles(VAULT_PATH);
      const allTasks = parseTasksFromFiles(files);

      // Filter tasks based on include_done flag
      const tasksToCheck = include_done
        ? allTasks
        : allTasks.filter(t => t.status === 'todo' || t.status === 'in_progress');

      // Group tasks by description (case-insensitive, trimmed)
      // If strict_match, also include due date in the key
      const taskGroups = {};
      for (const task of tasksToCheck) {
        let key = task.description.toLowerCase().trim();
        if (strict_match) {
          // Include due date in key - tasks with different due dates won't be grouped
          key += `|due:${task.dueDate || 'none'}`;
        }
        if (!taskGroups[key]) {
          taskGroups[key] = [];
        }
        taskGroups[key].push(task);
      }

      // Find duplicates (groups with 2+ tasks)
      const duplicates = Object.entries(taskGroups)
        .filter(([, tasks]) => tasks.length > 1)
        .sort((a, b) => b[1].length - a[1].length); // Sort by count, descending

      // Format output
      let output = '';
      const totalDuplicates = duplicates.reduce((sum, [, tasks]) => sum + tasks.length, 0);
      const uniqueCount = duplicates.length;

      output += `🔍 Duplicate Task Report\n\n`;
      output += `Found ${totalDuplicates} duplicate tasks across ${uniqueCount} unique descriptions\n`;
      output += `Scanning: ${include_done ? 'All tasks' : 'Incomplete tasks only'}`;
      output += `${strict_match ? ' (strict: matching due dates)' : ''}\n\n`;

      if (duplicates.length === 0) {
        output += '✅ No duplicates found!';
      } else {
        output += '---\n\n';

        for (const [description, tasks] of duplicates.slice(0, 20)) {
          output += `📋 "${description}" (${tasks.length} instances)\n`;
          for (const task of tasks) {
            const status = task.status === 'done' ? '[x]' : task.status === 'cancelled' ? '[-]' : '[ ]';
            const pathShort = task.path.replace(VAULT_PATH + '/', '');
            output += `   ${status} 📁 ${pathShort}\n`;
          }
          output += '\n';
        }

        if (duplicates.length > 20) {
          output += `\n... and ${duplicates.length - 20} more duplicate sets (showing first 20)\n`;
        }
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'consolidate_duplicate_task') {
    const { task_description, canonical_file_path } = args || {};

    try {
      if (!task_description || task_description.trim() === '') {
        return {
          content: [{ type: 'text', text: 'Error: task_description is required' }],
          isError: true,
        };
      }
      if (!canonical_file_path || canonical_file_path.trim() === '') {
        return {
          content: [{ type: 'text', text: 'Error: canonical_file_path is required' }],
          isError: true,
        };
      }

      // Scan all markdown files
      const files = await scanMarkdownFiles(VAULT_PATH);
      const allTasks = parseTasksFromFiles(files);

      // Find all incomplete tasks matching this description (case-insensitive)
      const descLower = task_description.toLowerCase().trim();
      const matchingTasks = allTasks.filter(
        t => (t.status === 'todo' || t.status === 'in_progress') &&
             t.description.toLowerCase().trim() === descLower
      );

      if (matchingTasks.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No incomplete tasks found matching: "${task_description}"`,
          }],
          isError: true,
        };
      }

      // Verify canonical file exists in matches
      const canonicalFullPath = path.join(VAULT_PATH, canonical_file_path);
      const canonicalTask = matchingTasks.find(t => t.path === canonicalFullPath);

      if (!canonicalTask) {
        const availablePaths = matchingTasks.map(t => t.path.replace(VAULT_PATH + '/', '')).join('\n  ');
        return {
          content: [{
            type: 'text',
            text: `Canonical file not found in matching tasks: "${canonical_file_path}"\n\nAvailable paths:\n  ${availablePaths}`,
          }],
          isError: true,
        };
      }

      // Get canonical filename without extension for the link
      const canonicalFilename = path.basename(canonical_file_path, '.md');

      // Today's date for cancellation stamp
      const today = new Date().toLocaleDateString('en-CA');

      // Process non-canonical tasks
      const tasksToCancel = matchingTasks.filter(t => t.path !== canonicalFullPath);
      let cancelledCount = 0;
      const cancelledFiles = [];

      for (const task of tasksToCancel) {
        // Find the file in our scanned files
        const file = files.find(f => f.path === task.path);
        if (!file) continue;

        // Build regex to find this specific task line
        // Note: task.description has dates stripped, but the raw line may have trailing
        // date metadata (📅, ⏳, 🛫, etc.), so we allow optional trailing content
        const escapedDesc = task.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const taskPattern = new RegExp(
          `^(\\s*- \\[ \\] )(${escapedDesc})(.*)$`,
          'm'
        );

        const match = file.content.match(taskPattern);
        if (match) {
          // Build the new cancelled task line
          const newTaskLine = match[0]
            .replace('- [ ] ', '- [-] ')
            .trimEnd() + ` → see [[${canonicalFilename}]] ❌ ${today}`;

          const newContent = file.content.replace(match[0], newTaskLine);
          await fs.writeFile(file.path, newContent, 'utf-8');

          cancelledCount++;
          cancelledFiles.push(task.path.replace(VAULT_PATH + '/', ''));
        }
      }

      // Format output
      let output = `🔗 Consolidated duplicate task\n\n`;
      output += `📋 "${task_description}"\n\n`;
      output += `✅ Canonical: ${canonical_file_path}\n\n`;

      if (cancelledCount > 0) {
        output += `❌ Cancelled ${cancelledCount} duplicate(s):\n`;
        for (const filePath of cancelledFiles) {
          output += `   📁 ${filePath}\n`;
        }
      } else {
        output += `No duplicates needed cancellation.\n`;
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'task_health_check') {
    const { include_done, max_examples = 10 } = args || {};

    try {
      // Scan all markdown files
      const files = await scanMarkdownFiles(VAULT_PATH);
      const allTasks = parseTasksFromFiles(files);

      // Filter tasks based on include_done flag
      const tasksToCheck = include_done
        ? allTasks
        : allTasks.filter(t => t.status === 'todo' || t.status === 'in_progress');

      // Health check patterns
      const CONTEXT_TAG_PATTERN = /#context\//i;
      const DATE_EMOJI_PATTERN = /📅|⏳|🛫/;
      const VALID_DUE_DATE = /📅\s*\d{4}-\d{2}-\d{2}/;
      const VALID_SCHEDULED_DATE = /⏳\s*\d{4}-\d{2}-\d{2}/;
      const VALID_START_DATE = /🛫\s*\d{4}-\d{2}-\d{2}/;
      // Patterns for dates with missing leading zeros (malformed)
      const MALFORMED_DATE_PATTERN = /(📅|⏳|🛫)\s*\d{4}-\d{1,2}-\d{1,2}(?!\d)/;
      const PRONOUN_START_PATTERN = /^(it|this|that|these|those)\b/i;
      const FILE_CONTEXT_PATTERN = /(the above|mentioned earlier|from yesterday|see below|as discussed|per above)/i;
      const ACTION_VERBS = [
        'buy', 'send', 'review', 'call', 'email', 'schedule', 'create', 'update',
        'fix', 'write', 'read', 'check', 'complete', 'finish', 'start', 'plan',
        'prepare', 'submit', 'confirm', 'cancel', 'book', 'order', 'pay', 'file',
        'clean', 'organize', 'setup', 'install', 'remove', 'delete', 'add', 'move',
        'ask', 'tell', 'discuss', 'meet', 'attend', 'present', 'research', 'find',
        'draft', 'edit', 'approve', 'sign', 'print', 'scan', 'upload', 'download',
        'backup', 'sync', 'test', 'debug', 'deploy', 'release', 'merge', 'push',
        'pull', 'commit', 'refactor', 'document', 'announce', 'notify', 'remind',
        'follow', 'track', 'monitor', 'measure', 'analyze', 'report', 'share',
        'publish', 'post', 'tweet', 'message', 'reply', 'respond', 'forward',
        'archive', 'rename', 'copy', 'paste', 'export', 'import', 'migrate',
        'transfer', 'convert', 'format', 'validate', 'verify', 'audit', 'inspect',
        'apply', 'register', 'subscribe', 'unsubscribe', 'renew', 'extend', 'replace',
        'return', 'exchange', 'mail', 'ship', 'deliver', 'pick', 'drop', 'take',
        'bring', 'get', 'put', 'set', 'make', 'build', 'design', 'implement',
        'configure', 'enable', 'disable', 'activate', 'deactivate', 'launch', 'run',
        'count', 'grep', 'list', 'explore', 'investigate', 'brainstorm', 'outline',
        'schedule', 'prioritize', 'delegate', 'assign', 'coordinate', 'facilitate'
      ];

      // Issue tracking
      const issues = {
        missingContextTag: [],
        malformedDate: [],
        tooShort: [],
        pronounStart: [],
        missingActionVerb: [],
        fileContextRef: [],
      };

      for (const task of tasksToCheck) {
        const desc = task.description;
        const pathShort = task.path.replace(VAULT_PATH + '/', '');

        // Check for missing context tag
        const hasContextTag = task.tags.some(t => CONTEXT_TAG_PATTERN.test(t));
        if (!hasContextTag) {
          issues.missingContextTag.push({ task, pathShort });
        }

        // Check for malformed dates (has date emoji but invalid format)
        // Check each date type separately
        if (task.raw.includes('📅')) {
          if (!VALID_DUE_DATE.test(task.raw)) {
            issues.malformedDate.push({ task, pathShort, dateType: 'due (📅)' });
          }
        }
        if (task.raw.includes('⏳')) {
          if (!VALID_SCHEDULED_DATE.test(task.raw)) {
            issues.malformedDate.push({ task, pathShort, dateType: 'scheduled (⏳)' });
          }
        }
        if (task.raw.includes('🛫')) {
          if (!VALID_START_DATE.test(task.raw)) {
            issues.malformedDate.push({ task, pathShort, dateType: 'start (🛫)' });
          }
        }

        // Strip tags from description for clarity checks
        const descNoTags = desc.replace(/#[\w\-\/]+/g, '').trim();
        const wordCount = descNoTags.split(/\s+/).filter(w => w.length > 0).length;

        // Check for too short (< 5 words, likely vague)
        if (wordCount < 5 && wordCount > 0) {
          issues.tooShort.push({ task, pathShort, wordCount });
        }

        // Check for pronoun start
        if (PRONOUN_START_PATTERN.test(descNoTags)) {
          issues.pronounStart.push({ task, pathShort });
        }

        // Check for missing action verb (first word should be a verb)
        // Strip leading person name patterns: "Name:", "Name/Name:", "**Name**:"
        const PERSON_PREFIX_PATTERN = /^(\*\*\w+\*\*:|\w+\/\w+:|\w+:)\s*/i;
        const descForVerbCheck = descNoTags.replace(PERSON_PREFIX_PATTERN, '');
        const firstWord = descForVerbCheck.split(/\s+/)[0]?.toLowerCase() || '';
        const hasActionVerb = ACTION_VERBS.some(v => firstWord === v || firstWord.startsWith(v));
        if (wordCount >= 2 && !hasActionVerb && firstWord.length > 0) {
          issues.missingActionVerb.push({ task, pathShort, firstWord });
        }

        // Check for file-context references
        if (FILE_CONTEXT_PATTERN.test(descNoTags)) {
          issues.fileContextRef.push({ task, pathShort });
        }
      }

      // Format output
      let output = `🏥 Task Health Check Report\n\n`;
      output += `Scanned ${tasksToCheck.length} ${include_done ? 'total' : 'incomplete'} tasks\n\n`;

      const totalIssues = Object.values(issues).reduce((sum, arr) => sum + arr.length, 0);
      output += `Found ${totalIssues} issues across ${Object.keys(issues).length} categories\n\n`;
      output += `---\n\n`;

      // Missing context tags
      output += `## 🏷️ Missing Context Tags (${issues.missingContextTag.length})\n`;
      output += `Tasks without any #context/* tag\n\n`;
      if (issues.missingContextTag.length === 0) {
        output += `✅ None found!\n\n`;
      } else {
        for (const { task, pathShort } of issues.missingContextTag.slice(0, max_examples)) {
          output += `- [ ] ${task.description.substring(0, 60)}${task.description.length > 60 ? '...' : ''}\n`;
          output += `  📁 ${pathShort}\n`;
        }
        if (issues.missingContextTag.length > max_examples) {
          output += `  ... and ${issues.missingContextTag.length - max_examples} more\n`;
        }
        output += `\n`;
      }

      // Malformed dates
      output += `## 📅 Malformed Dates (${issues.malformedDate.length})\n`;
      output += `Tasks with date emojis (📅⏳🛫) but invalid format (must be YYYY-MM-DD with leading zeros)\n\n`;
      if (issues.malformedDate.length === 0) {
        output += `✅ None found!\n\n`;
      } else {
        for (const { task, pathShort, dateType } of issues.malformedDate.slice(0, max_examples)) {
          output += `- [ ] ${task.description.substring(0, 60)}${task.description.length > 60 ? '...' : ''}\n`;
          output += `  Type: ${dateType || 'unknown'}\n`;
          output += `  Raw: ${task.raw.trim().substring(0, 80)}...\n`;
          output += `  📁 ${pathShort}\n`;
        }
        if (issues.malformedDate.length > max_examples) {
          output += `  ... and ${issues.malformedDate.length - max_examples} more\n`;
        }
        output += `\n`;
      }

      // Too short
      output += `## 📏 Too Short / Vague (${issues.tooShort.length})\n`;
      output += `Tasks with fewer than 5 words\n\n`;
      if (issues.tooShort.length === 0) {
        output += `✅ None found!\n\n`;
      } else {
        for (const { task, pathShort, wordCount } of issues.tooShort.slice(0, max_examples)) {
          output += `- [ ] "${task.description}" (${wordCount} words)\n`;
          output += `  📁 ${pathShort}\n`;
        }
        if (issues.tooShort.length > max_examples) {
          output += `  ... and ${issues.tooShort.length - max_examples} more\n`;
        }
        output += `\n`;
      }

      // Pronoun start
      output += `## 👆 Pronoun Starters (${issues.pronounStart.length})\n`;
      output += `Tasks starting with "it", "this", "that" without clear subject\n\n`;
      if (issues.pronounStart.length === 0) {
        output += `✅ None found!\n\n`;
      } else {
        for (const { task, pathShort } of issues.pronounStart.slice(0, max_examples)) {
          output += `- [ ] ${task.description.substring(0, 60)}${task.description.length > 60 ? '...' : ''}\n`;
          output += `  📁 ${pathShort}\n`;
        }
        if (issues.pronounStart.length > max_examples) {
          output += `  ... and ${issues.pronounStart.length - max_examples} more\n`;
        }
        output += `\n`;
      }

      // Missing action verb
      output += `## 🎬 Missing Action Verb (${issues.missingActionVerb.length})\n`;
      output += `Tasks not starting with a clear action verb\n\n`;
      if (issues.missingActionVerb.length === 0) {
        output += `✅ None found!\n\n`;
      } else {
        for (const { task, pathShort, firstWord } of issues.missingActionVerb.slice(0, max_examples)) {
          output += `- [ ] ${task.description.substring(0, 60)}${task.description.length > 60 ? '...' : ''}\n`;
          output += `  First word: "${firstWord}"\n`;
          output += `  📁 ${pathShort}\n`;
        }
        if (issues.missingActionVerb.length > max_examples) {
          output += `  ... and ${issues.missingActionVerb.length - max_examples} more\n`;
        }
        output += `\n`;
      }

      // File context references
      output += `## 📄 File-Context References (${issues.fileContextRef.length})\n`;
      output += `Tasks with phrases like "the above", "mentioned earlier"\n\n`;
      if (issues.fileContextRef.length === 0) {
        output += `✅ None found!\n\n`;
      } else {
        for (const { task, pathShort } of issues.fileContextRef.slice(0, max_examples)) {
          output += `- [ ] ${task.description.substring(0, 60)}${task.description.length > 60 ? '...' : ''}\n`;
          output += `  📁 ${pathShort}\n`;
        }
        if (issues.fileContextRef.length > max_examples) {
          output += `  ... and ${issues.fileContextRef.length - max_examples} more\n`;
        }
        output += `\n`;
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'update_task_date') {
    const { task_id, new_date, date_type = 'due' } = args || {};

    try {
      // Validate task_id
      if (!task_id || task_id.trim() === '') {
        return {
          content: [{ type: 'text', text: 'Error: task_id is required' }],
          isError: true,
        };
      }

      // Validate new_date format (YYYY-MM-DD)
      if (!new_date || !/^\d{4}-\d{2}-\d{2}$/.test(new_date)) {
        return {
          content: [{
            type: 'text',
            text: `Error: new_date must be in YYYY-MM-DD format. Received: "${new_date}"`,
          }],
          isError: true,
        };
      }

      // Validate the date is a real date
      const [year, month, day] = new_date.split('-').map(Number);
      const testDate = new Date(year, month - 1, day);
      if (testDate.getFullYear() !== year || testDate.getMonth() !== month - 1 || testDate.getDate() !== day) {
        return {
          content: [{
            type: 'text',
            text: `Error: Invalid date: "${new_date}". Please provide a valid date.`,
          }],
          isError: true,
        };
      }

      // Validate date_type and get corresponding emoji
      const dateTypeMap = {
        'due': '📅',
        'scheduled': '⏳',
        'start': '🛫',
      };

      if (!dateTypeMap[date_type]) {
        return {
          content: [{
            type: 'text',
            text: `Error: Invalid date_type: "${date_type}". Must be "due", "scheduled", or "start".`,
          }],
          isError: true,
        };
      }

      const dateEmoji = dateTypeMap[date_type];
      const datePattern = new RegExp(`${dateEmoji}\\s*\\d{4}-\\d{2}-\\d{2}`);

      // Scan all markdown files
      const files = await scanMarkdownFiles(VAULT_PATH);

      let found = false;
      let matchedFile = '';
      let oldDate = null;
      let newTaskLine = '';

      // Search by task ID
      const idPattern = new RegExp(
        `^(\\s*- \\[.\\] )(.*)🆔\\s*${task_id}\\s*$`,
        'm'
      );

      for (const file of files) {
        const match = file.content.match(idPattern);
        if (match) {
          const fullLine = match[0];

          // Check if this date type already exists
          const existingDateMatch = fullLine.match(datePattern);
          if (existingDateMatch) {
            // Extract old date for reporting
            const oldDateMatch = existingDateMatch[0].match(/\d{4}-\d{2}-\d{2}/);
            oldDate = oldDateMatch ? oldDateMatch[0] : null;

            // Replace existing date
            newTaskLine = fullLine.replace(datePattern, `${dateEmoji} ${new_date}`);
          } else {
            // No existing date of this type - insert before the ID
            const idIndex = fullLine.lastIndexOf('🆔');
            const beforeId = fullLine.slice(0, idIndex).trimEnd();
            const idPart = fullLine.slice(idIndex);
            newTaskLine = `${beforeId} ${dateEmoji} ${new_date} ${idPart}`;
          }

          const newContent = file.content.replace(fullLine, newTaskLine);
          await fs.writeFile(file.path, newContent, 'utf-8');

          found = true;
          matchedFile = file.path.replace(VAULT_PATH + '/', '');
          break;
        }
      }

      if (!found) {
        return {
          content: [{
            type: 'text',
            text: `Could not find task with ID: "${task_id}"`,
          }],
          isError: true,
        };
      }

      // Format success message
      const dateTypeName = date_type === 'due' ? 'due date' : date_type === 'scheduled' ? 'scheduled date' : 'start date';
      const actionWord = oldDate ? 'Updated' : 'Added';
      const changeText = oldDate ? `${oldDate} → ${new_date}` : new_date;

      return {
        content: [{
          type: 'text',
          text: `${dateEmoji} ${actionWord} ${dateTypeName}: ${changeText}\n🆔 ${task_id}\n📁 ${matchedFile}`,
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'count_available_tasks') {
    const {
      path_includes,
      path_excludes = 'templates',
      tag_includes,
      tag_excludes = 'someday',
      show_breakdown = false,
    } = args || {};

    try {
      // Scan all markdown files and parse tasks
      const files = await scanMarkdownFiles(VAULT_PATH);
      const allTasks = parseTasksFromFiles(files);

      // Get today's date for comparison (normalized to midnight)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Helper to parse date string to Date object
      const parseTaskDate = (dateStr) => {
        if (!dateStr) return null;
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      };

      // Normalize tag for comparison
      // If tag starts with #, do exact match. Otherwise, do substring match.
      const normalizeTag = (tag) => {
        if (!tag) return null;
        return tag.toLowerCase();
      };

      const excludeTag = normalizeTag(tag_excludes);
      const includeTag = normalizeTag(tag_includes);
      
      // Determine match type based on presence of #
      const excludeIsExact = tag_excludes && tag_excludes.startsWith('#');
      const includeIsExact = tag_includes && tag_includes.startsWith('#');

      // Track breakdown counts
      const breakdown = {
        noStartOrScheduled: 0,
        startDateReady: 0,
        scheduledDateReady: 0,
      };

      // Filter to available tasks
      const availableTasks = allTasks.filter(task => {
        // Must be incomplete (todo or in_progress)
        if (task.status !== 'todo' && task.status !== 'in_progress') {
          return false;
        }

        // Apply path filters
        const pathLower = task.path.toLowerCase();
        if (path_excludes && pathLower.includes(path_excludes.toLowerCase())) {
          return false;
        }
        if (path_includes && !pathLower.includes(path_includes.toLowerCase())) {
          return false;
        }

        // Apply tag filters
        const taskTagsLower = task.tags.map(t => t.toLowerCase());
        
        // Exclude tag filter
        if (excludeTag) {
          if (excludeIsExact) {
            // Exact match: tag must exactly equal excludeTag
            if (taskTagsLower.includes(excludeTag)) {
              return false;
            }
          } else {
            // Substring match: any tag containing excludeTag substring
            if (taskTagsLower.some(t => t.includes(excludeTag))) {
              return false;
            }
          }
        }
        
        // Include tag filter
        if (includeTag) {
          if (includeIsExact) {
            // Exact match: must have this exact tag
            if (!taskTagsLower.includes(includeTag)) {
              return false;
            }
          } else {
            // Substring match: must have at least one tag containing this substring
            if (!taskTagsLower.some(t => t.includes(includeTag))) {
              return false;
            }
          }
        }

        // Check availability based on start/scheduled dates
        const startDate = parseTaskDate(task.startDate);
        const scheduledDate = parseTaskDate(task.scheduledDate);

        // Case 1: No start date AND no scheduled date = available
        if (!startDate && !scheduledDate) {
          breakdown.noStartOrScheduled++;
          return true;
        }

        // Case 2: Has start date on or before today = available
        if (startDate && startDate <= today) {
          breakdown.startDateReady++;
          return true;
        }

        // Case 3: Has scheduled date on or before today = available
        if (scheduledDate && scheduledDate <= today) {
          breakdown.scheduledDateReady++;
          return true;
        }

        // Otherwise, task is not yet available (future start/scheduled date)
        return false;
      });

      // Format output
      const todayStr = today.toLocaleDateString('en-CA');
      let output = `📊 Available Tasks: ${availableTasks.length}\n`;
      output += `📅 As of: ${todayStr}\n\n`;

      // Show active filters
      const filters = [];
      if (path_includes) filters.push(`path includes "${path_includes}"`);
      if (path_excludes) filters.push(`path excludes "${path_excludes}"`);
      if (tag_includes) filters.push(`tag includes "${tag_includes}"`);
      if (tag_excludes) filters.push(`tag excludes "${tag_excludes}"`);

      if (filters.length > 0) {
        output += `Filters: ${filters.join(', ')}\n\n`;
      }

      if (show_breakdown) {
        output += `Breakdown:\n`;
        output += `  No start/scheduled date: ${breakdown.noStartOrScheduled}\n`;
        output += `  Start date ready (🛫 ≤ today): ${breakdown.startDateReady}\n`;
        output += `  Scheduled date ready (⏳ ≤ today): ${breakdown.scheduledDateReady}\n`;
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Obsidian Tasks MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
