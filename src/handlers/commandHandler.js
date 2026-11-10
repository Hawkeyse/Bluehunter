const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

/**
 * Recursively loads every command file under src/commands/**
 * Each command file must export: { name, aliases?, description, category,
 *   ownerOnly?, adminOnly?, groupOnly?, execute(ctx) }
 * Returns a Map<name, command>
 */
// Loaded once and reused. /help used to call loadCommands() on every use,
// re-walking the commands folder and writing a "Loaded N commands" log line
// each time. Pass { force: true } if you ever add hot-reloading.
let cachedCommands = null;

function loadCommands({ force = false } = {}) {
  if (cachedCommands && !force) return cachedCommands;
  const commands = new Map();

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        try {
          const command = require(fullPath);
          if (!command || !command.name || typeof command.execute !== 'function') {
            logger.warn(`Skipped invalid command file: ${fullPath}`);
            continue;
          }
          commands.set(command.name, command);
          (command.aliases || []).forEach((alias) => commands.set(alias, command));
        } catch (err) {
          logger.error(`Failed to load command ${fullPath}:`, err.message);
        }
      }
    }
  }

  walk(COMMANDS_DIR);
  logger.info(`Loaded ${new Set([...commands.values()]).size} commands`);
  cachedCommands = commands;
  return commands;
}

module.exports = { loadCommands };
