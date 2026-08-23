'use strict';
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function onLoad(api) {
  api.log.info('shell-tools onLoad');
}

async function onEnable(api) {
  api.log.info('shell-tools onEnable - registering shell and read tools');

  // Shell tool - executes a command and returns output
  api.tools.register({
    name: 'shell',
    description: 'Execute a shell command and return stdout/stderr. Use for running commands, listing files, checking system status, etc. Command runs in the project directory.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional, defaults to project root)' },
        timeout: { type: 'number', description: 'Timeout in ms (default 10000)' }
      },
      required: ['command']
    },
    execute: async ({ command, cwd, timeout }) => {
      if (!command || typeof command !== 'string') throw new Error('command is required');
      if (command.length > 2000) throw new Error('command too long');
      // Basic block for dangerous commands (optional safety)
      const blocked = ['rm -rf /', 'format C:', ':(){', 'mkfs'];
      for (const b of blocked) if (command.includes(b)) throw new Error(`Blocked dangerous command: ${b}`);
      
      const execCwd = cwd ? path.resolve(cwd) : path.join(__dirname, '..', '..');
      // Prevent escaping project root too far? Allow but log
      api.log.info(`shell: ${command} (cwd=${execCwd})`);
      
      return new Promise((resolve, reject) => {
        exec(command, { cwd: execCwd, timeout: timeout || 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
          let output = '';
          if (stdout) output += `STDOUT:\n${stdout}\n`;
          if (stderr) output += `STDERR:\n${stderr}\n`;
          if (error) {
            output += `Error: ${error.message}\n`;
            // Still return output, not throw, so AI can see the error
            resolve({ text: output.slice(0, 8000) });
          } else {
            resolve({ text: output.slice(0, 8000) || '(no output)' });
          }
        });
      });
    }
  });

  // Read tool - reads a file and returns content
  api.tools.register({
    name: 'read',
    description: 'Read a file and return its content. Use for reading code, configs, logs, etc. Path is relative to project root or absolute. Max 100KB.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read (relative to project root or absolute)' },
        encoding: { type: 'string', description: 'Encoding (default utf8)', enum: ['utf8', 'base64'] }
      },
      required: ['path']
    },
    execute: async ({ path: filePath, encoding }) => {
      if (!filePath || typeof filePath !== 'string') throw new Error('path is required');
      // Prevent reading sensitive files
      const blockedFiles = ['credentials.json', 'mcp-credentials.json', '.env'];
      const baseName = path.basename(filePath);
      if (blockedFiles.includes(baseName)) throw new Error(`Reading ${baseName} is not allowed for security`);
      
      let fullPath = filePath;
      if (!path.isAbsolute(filePath)) {
        fullPath = path.resolve(path.join(__dirname, '..', '..'), filePath);
      }
      // Ensure within project or user allowed area - for now allow any, but log
      api.log.info(`read: ${filePath} -> ${fullPath}`);
      
      const stat = await fs.promises.stat(fullPath).catch(() => null);
      if (!stat) throw new Error(`File not found: ${filePath}`);
      if (stat.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`);
      if (stat.size > 100 * 1024) throw new Error(`File too large (${stat.size} bytes, max 100KB). Use shell with head/tail.`);
      
      const content = await fs.promises.readFile(fullPath, encoding || 'utf8');
      // Truncate if still too large
      const text = String(content).slice(0, 8000);
      return { text: `File: ${filePath} (${stat.size} bytes)\n\n${text}` };
    }
  });

  api.log.info('shell-tools registered: shell, read');
}

async function onDisable(api) {
  api.log.info('shell-tools onDisable');
}

async function onUnload(api) {
  (api || { log: { info: () => {} } }).log.info('shell-tools onUnload');
}

module.exports = { onLoad, onEnable, onDisable, onUnload };
