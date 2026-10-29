/**
 * Parse task lines from markdown content
 */

// Task checkbox pattern: - [ ], - [x], - [-], - [/]
const TASK_REGEX = /^(\s*)- \[([x \-\/])\]\s*(.*)$/i;

// Metadata patterns
const DUE_DATE_REGEX = /📅\s*(\d{4}-\d{2}-\d{2})/;
const SCHEDULED_DATE_REGEX = /⏳\s*(\d{4}-\d{2}-\d{2})/;
const START_DATE_REGEX = /🛫\s*(\d{4}-\d{2}-\d{2})/;
const DONE_DATE_REGEX = /✅\s*(\d{4}-\d{2}-\d{2})/;
const CANCELLED_DATE_REGEX = /❌\s*(\d{4}-\d{2}-\d{2})/;

// Tag pattern: #word or #word/subword
const TAG_REGEX = /#[\w\-\/]+/g;

// Task ID pattern: 🆔 followed by 6 alphanumeric characters (added by Morgen)
const TASK_ID_REGEX = /🆔\s*([A-Za-z0-9]{6})/;

/**
 * Parse a single task line
 * @param {string} line - The markdown line
 * @param {string} filePath - Path to the source file
 * @returns {object|null} - Parsed task or null if not a task
 */
export function parseTaskLine(line, filePath) {
  const match = line.match(TASK_REGEX);
  if (!match) return null;

  const [, indent, checkbox, content] = match;

  // Determine status from checkbox
  const checkboxLower = checkbox.toLowerCase();
  let status;
  if (checkboxLower === 'x') {
    status = 'done';
  } else if (checkbox === '-') {
    status = 'cancelled';
  } else if (checkbox === '/') {
    status = 'in_progress';
  } else {
    status = 'todo';
  }

  // Extract dates
  const dueMatch = content.match(DUE_DATE_REGEX);
  const scheduledMatch = content.match(SCHEDULED_DATE_REGEX);
  const startMatch = content.match(START_DATE_REGEX);
  const doneMatch = content.match(DONE_DATE_REGEX);
  const cancelledMatch = content.match(CANCELLED_DATE_REGEX);

  // Extract tags
  const tags = content.match(TAG_REGEX) || [];

  // Extract task ID (Morgen format: 🆔 followed by 6 alphanumeric chars)
  const idMatch = content.match(TASK_ID_REGEX);
  const taskId = idMatch ? idMatch[1] : null;

  // Clean description (remove metadata emojis and dates for cleaner display)
  let description = content
    .replace(/📅\s*\d{4}-\d{2}-\d{2}/g, '')
    .replace(/⏳\s*\d{4}-\d{2}-\d{2}/g, '')
    .replace(/🛫\s*\d{4}-\d{2}-\d{2}/g, '')
    .replace(/✅\s*\d{4}-\d{2}-\d{2}/g, '')
    .replace(/❌\s*\d{4}-\d{2}-\d{2}/g, '')
    .replace(/🆔\s*\S+/g, '') // Remove task IDs
    .trim();

  return {
    raw: line,
    status,
    description,
    taskId,
    dueDate: dueMatch ? dueMatch[1] : null,
    scheduledDate: scheduledMatch ? scheduledMatch[1] : null,
    startDate: startMatch ? startMatch[1] : null,
    doneDate: doneMatch ? doneMatch[1] : null,
    cancelledDate: cancelledMatch ? cancelledMatch[1] : null,
    tags,
    path: filePath,
    indentLevel: indent.length,
  };
}

/**
 * Parse all tasks from a markdown file
 * @param {string} content - File content
 * @param {string} filePath - Path to the file
 * @returns {Array<object>} - Array of parsed tasks
 */
export function parseTasksFromFile(content, filePath) {
  const lines = content.split('\n');
  const tasks = [];

  for (const line of lines) {
    const task = parseTaskLine(line, filePath);
    if (task) {
      tasks.push(task);
    }
  }

  return tasks;
}

/**
 * Parse tasks from multiple files
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<object>} - All parsed tasks
 */
export function parseTasksFromFiles(files) {
  const allTasks = [];

  for (const file of files) {
    const tasks = parseTasksFromFile(file.content, file.path);
    allTasks.push(...tasks);
  }

  return allTasks;
}
