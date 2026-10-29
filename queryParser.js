/**
 * Parse Tasks plugin query syntax and filter tasks
 *
 * Supported filters:
 * - done / not done
 * - path includes <string> / path does not include <string>
 * - tags include <tag> / tags do not include <tag>
 * - happens before <date> / happens on or before <date>
 * - happens after <date> / happens on or after <date>
 */

/**
 * Parse a date string into a Date object
 * Supports: YYYY-MM-DD, "today", "tomorrow", "yesterday"
 */
function parseDate(dateStr) {
  const str = dateStr.trim().toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (str === 'today') {
    return today;
  } else if (str === 'tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  } else if (str === 'yesterday') {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return d;
  } else {
    // Try YYYY-MM-DD format
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }
  }
  return null;
}

/**
 * Get the "happens" date for a task (first of: due, scheduled, start)
 */
function getHappensDate(task) {
  const dateStr = task.dueDate || task.scheduledDate || task.startDate;
  if (!dateStr) return null;
  return parseDate(dateStr);
}

/**
 * Parse a single filter line into a filter function
 * @param {string} line - Filter line
 * @returns {Function|null} - Filter function or null if not recognized
 */
function parseFilterLine(line) {
  const trimmed = line.trim().toLowerCase();
  if (!trimmed || trimmed.startsWith('#')) return null; // Skip empty lines and comments

  // Status filters
  if (trimmed === 'done') {
    return (task) => task.status === 'done';
  }
  if (trimmed === 'not done') {
    // Only return incomplete tasks (todo/in_progress), excluding cancelled tasks
    return (task) => task.status === 'todo' || task.status === 'in_progress';
  }
  if (trimmed === 'cancelled') {
    return (task) => task.status === 'cancelled';
  }
  if (trimmed === 'not cancelled') {
    return (task) => task.status !== 'cancelled';
  }

  // Path filters
  const pathIncludes = trimmed.match(/^path includes (.+)$/);
  if (pathIncludes) {
    const searchStr = pathIncludes[1].trim();
    return (task) => task.path.toLowerCase().includes(searchStr);
  }

  const pathNotIncludes = trimmed.match(/^path does not include (.+)$/);
  if (pathNotIncludes) {
    const searchStr = pathNotIncludes[1].trim();
    return (task) => !task.path.toLowerCase().includes(searchStr);
  }

  // Tag filters
  // If search term starts with #, do exact match. Otherwise, do substring match.
  const tagsInclude = trimmed.match(/^tags? includes? (.+)$/);
  if (tagsInclude) {
    const searchTag = tagsInclude[1].trim();
    const isExact = searchTag.startsWith('#');
    const searchLower = searchTag.toLowerCase();
    
    return (task) => {
      const taskTagsLower = task.tags.map(t => t.toLowerCase());
      if (isExact) {
        // Exact match
        return taskTagsLower.includes(searchLower);
      } else {
        // Substring match
        return taskTagsLower.some(t => t.includes(searchLower));
      }
    };
  }

  const tagsNotInclude = trimmed.match(/^tags? do(?:es)? not include (.+)$/);
  if (tagsNotInclude) {
    const searchTag = tagsNotInclude[1].trim();
    const isExact = searchTag.startsWith('#');
    const searchLower = searchTag.toLowerCase();
    
    return (task) => {
      const taskTagsLower = task.tags.map(t => t.toLowerCase());
      if (isExact) {
        // Exact match
        return !taskTagsLower.includes(searchLower);
      } else {
        // Substring match
        return !taskTagsLower.some(t => t.includes(searchLower));
      }
    };
  }

  // Date filters - "happens before/after/on or before/on or after"
  const happensBefore = trimmed.match(/^happens before (.+)$/);
  if (happensBefore) {
    const targetDate = parseDate(happensBefore[1]);
    if (targetDate) {
      return (task) => {
        const taskDate = getHappensDate(task);
        return taskDate && taskDate < targetDate;
      };
    }
  }

  const happensOnOrBefore = trimmed.match(/^happens on or before (.+)$/);
  if (happensOnOrBefore) {
    const targetDate = parseDate(happensOnOrBefore[1]);
    if (targetDate) {
      return (task) => {
        const taskDate = getHappensDate(task);
        return taskDate && taskDate <= targetDate;
      };
    }
  }

  const happensAfter = trimmed.match(/^happens after (.+)$/);
  if (happensAfter) {
    const targetDate = parseDate(happensAfter[1]);
    if (targetDate) {
      return (task) => {
        const taskDate = getHappensDate(task);
        return taskDate && taskDate > targetDate;
      };
    }
  }

  const happensOnOrAfter = trimmed.match(/^happens on or after (.+)$/);
  if (happensOnOrAfter) {
    const targetDate = parseDate(happensOnOrAfter[1]);
    if (targetDate) {
      return (task) => {
        const taskDate = getHappensDate(task);
        return taskDate && taskDate >= targetDate;
      };
    }
  }

  // Start date filters - "starts before/after/on or before/on or after"
  const startsBefore = trimmed.match(/^starts before (.+)$/);
  if (startsBefore) {
    const targetDate = parseDate(startsBefore[1]);
    if (targetDate) {
      return (task) => {
        if (!task.startDate) return false;
        const taskDate = parseDate(task.startDate);
        return taskDate && taskDate < targetDate;
      };
    }
  }

  const startsOnOrBefore = trimmed.match(/^starts on or before (.+)$/);
  if (startsOnOrBefore) {
    const targetDate = parseDate(startsOnOrBefore[1]);
    if (targetDate) {
      return (task) => {
        if (!task.startDate) return false;
        const taskDate = parseDate(task.startDate);
        return taskDate && taskDate <= targetDate;
      };
    }
  }

  const startsAfter = trimmed.match(/^starts after (.+)$/);
  if (startsAfter) {
    const targetDate = parseDate(startsAfter[1]);
    if (targetDate) {
      return (task) => {
        if (!task.startDate) return false;
        const taskDate = parseDate(task.startDate);
        return taskDate && taskDate > targetDate;
      };
    }
  }

  const startsOnOrAfter = trimmed.match(/^starts on or after (.+)$/);
  if (startsOnOrAfter) {
    const targetDate = parseDate(startsOnOrAfter[1]);
    if (targetDate) {
      return (task) => {
        if (!task.startDate) return false;
        const taskDate = parseDate(task.startDate);
        return taskDate && taskDate >= targetDate;
      };
    }
  }

  // Scheduled date filters - "scheduled before/after/on or before/on or after"
  const scheduledBefore = trimmed.match(/^scheduled before (.+)$/);
  if (scheduledBefore) {
    const targetDate = parseDate(scheduledBefore[1]);
    if (targetDate) {
      return (task) => {
        if (!task.scheduledDate) return false;
        const taskDate = parseDate(task.scheduledDate);
        return taskDate && taskDate < targetDate;
      };
    }
  }

  const scheduledOnOrBefore = trimmed.match(/^scheduled on or before (.+)$/);
  if (scheduledOnOrBefore) {
    const targetDate = parseDate(scheduledOnOrBefore[1]);
    if (targetDate) {
      return (task) => {
        if (!task.scheduledDate) return false;
        const taskDate = parseDate(task.scheduledDate);
        return taskDate && taskDate <= targetDate;
      };
    }
  }

  const scheduledAfter = trimmed.match(/^scheduled after (.+)$/);
  if (scheduledAfter) {
    const targetDate = parseDate(scheduledAfter[1]);
    if (targetDate) {
      return (task) => {
        if (!task.scheduledDate) return false;
        const taskDate = parseDate(task.scheduledDate);
        return taskDate && taskDate > targetDate;
      };
    }
  }

  const scheduledOnOrAfter = trimmed.match(/^scheduled on or after (.+)$/);
  if (scheduledOnOrAfter) {
    const targetDate = parseDate(scheduledOnOrAfter[1]);
    if (targetDate) {
      return (task) => {
        if (!task.scheduledDate) return false;
        const taskDate = parseDate(task.scheduledDate);
        return taskDate && taskDate >= targetDate;
      };
    }
  }

  // "has due date" / "no due date"
  if (trimmed === 'has due date') {
    return (task) => task.dueDate !== null;
  }
  if (trimmed === 'no due date') {
    return (task) => task.dueDate === null;
  }

  // "has start date" / "no start date"
  if (trimmed === 'has start date') {
    return (task) => task.startDate !== null;
  }
  if (trimmed === 'no start date') {
    return (task) => task.startDate === null;
  }

  // "has scheduled date" / "no scheduled date"
  if (trimmed === 'has scheduled date') {
    return (task) => task.scheduledDate !== null;
  }
  if (trimmed === 'no scheduled date') {
    return (task) => task.scheduledDate === null;
  }

  // Description/text search
  const descriptionIncludes = trimmed.match(/^description includes (.+)$/);
  if (descriptionIncludes) {
    const searchStr = descriptionIncludes[1].trim();
    return (task) => task.description.toLowerCase().includes(searchStr);
  }

  // Unrecognized filter - return null (will be skipped with warning)
  return null;
}

/**
 * Parse a full query string into an array of filter functions
 * @param {string} query - Multi-line query string
 * @returns {{filters: Function[], unrecognized: string[]}}
 */
export function parseQuery(query) {
  const lines = query.split('\n');
  const filters = [];
  const unrecognized = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue; // Skip empty and comments

    const filter = parseFilterLine(trimmed);
    if (filter) {
      filters.push(filter);
    } else {
      unrecognized.push(trimmed);
    }
  }

  return { filters, unrecognized };
}

/**
 * Apply filters to a list of tasks
 * @param {Array} tasks - Array of parsed tasks
 * @param {Array<Function>} filters - Array of filter functions
 * @returns {Array} - Filtered tasks
 */
export function applyFilters(tasks, filters) {
  if (filters.length === 0) return tasks;

  return tasks.filter(task => {
    return filters.every(filter => filter(task));
  });
}

/**
 * Execute a query against tasks
 * @param {string} query - Query string
 * @param {Array} tasks - Array of parsed tasks
 * @returns {{results: Array, unrecognized: string[]}}
 */
export function executeQuery(query, tasks) {
  const { filters, unrecognized } = parseQuery(query);
  const results = applyFilters(tasks, filters);
  return { results, unrecognized };
}
