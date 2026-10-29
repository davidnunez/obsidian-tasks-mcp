import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Recursively scan a directory for .md files
 * @param {string} dir - Directory to scan
 * @returns {Promise<Array<{path: string, content: string}>>}
 */
export async function scanMarkdownFiles(dir) {
  const results = [];

  async function scan(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      // Skip hidden files/folders and common non-content directories
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          results.push({ path: fullPath, content });
        } catch (err) {
          // Skip files we can't read
          console.error(`Could not read ${fullPath}: ${err.message}`);
        }
      }
    }
  }

  await scan(dir);
  return results;
}
