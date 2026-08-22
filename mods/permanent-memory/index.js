'use strict';

let apiRef = null;
const STORAGE_FILE = 'memories.json';
const MAX_CONTENT_LENGTH = 2000;
const MAX_MEMORIES = 100;

// Helper to generate ID
function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function loadMemories(api) {
  try {
    if (await api.storage.exists(STORAGE_FILE)) {
      const raw = await api.storage.readFile(STORAGE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.memories)) return data.memories;
      return [];
    }
  } catch (e) {
    api.log.error(`failed to load memories: ${e.message}`);
  }
  return [];
}

async function saveMemories(api, memories) {
  await api.storage.writeFile(STORAGE_FILE, JSON.stringify(memories, null, 2));
}

function formatMemoriesForPrompt(memories) {
  if (!memories.length) {
    return 'No permanent memories stored yet. Use save_memory to store important facts.';
  }
  const lines = ['--- Permanent Memory ---', 'The following are permanent memories the user has asked you to remember. Use them to personalize your responses.'];
  // Sort deterministically by createdAt
  const sorted = [...memories].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const title = m.title ? `Title: ${m.title} | ` : '';
    const tags = m.tags && m.tags.length ? ` Tags: [${m.tags.join(', ')}]` : '';
    const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '';
    lines.push(`${i + 1}. [${m.id}] ${title}Content: ${m.content}${tags} ${date ? `(saved ${date})` : ''}`);
  }
  lines.push('--- End Permanent Memory ---');
  return lines.join('\n');
}

async function rebuildPrompt(api) {
  const memories = await loadMemories(api);
  const promptText = formatMemoriesForPrompt(memories);
  // Append to system prompt - this replaces previous contribution for this mod (same modId)
  api.systemPrompt.append(promptText);
  api.log.debug(`rebuilt system prompt with ${memories.length} memories (${promptText.length} chars)`);
}

async function onLoad(api) {
  apiRef = api;
  api.log.info(`onLoad v${api.manifest.version} - permanent memory mod`);
  // Ensure storage file exists
  const memories = await loadMemories(api);
  api.log.info(`loaded ${memories.length} existing memories`);
  // Ensure config defaults
  if (!api.config.has('maxMemories')) api.config.set('maxMemories', MAX_MEMORIES);
}

async function onEnable(api) {
  apiRef = api;
  api.log.info('onEnable - registering permanent memory tools and prompt');

  // Initial prompt build
  await rebuildPrompt(api);

  // Tool: save_memory
  api.tools.register({
    name: 'save_memory',
    description: 'Save a permanent memory entry. Use when the user asks to remember something, save a fact, preference, or note for future conversations. The memory will be appended to the system prompt.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The content to remember (1-2000 chars)' },
        title: { type: 'string', description: 'Optional short title for the memory' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for categorization' }
      },
      required: ['content']
    },
    execute: async (args) => {
      const content = String(args.content || '').trim();
      if (!content) throw new Error('content is required');
      if (content.length > MAX_CONTENT_LENGTH) throw new Error(`content too long (max ${MAX_CONTENT_LENGTH})`);
      const title = args.title ? String(args.title).trim().slice(0, 100) : '';
      const tags = Array.isArray(args.tags) ? args.tags.map(t => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 10) : [];

      let memories = await loadMemories(api);
      const max = api.config.get('maxMemories', MAX_MEMORIES);
      if (memories.length >= max) throw new Error(`Memory limit reached (${max}). Delete some memories first.`);

      const entry = {
        id: generateId(),
        content,
        title,
        tags,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      memories.push(entry);
      await saveMemories(api, memories);
      await rebuildPrompt(api);
      api.log.info(`saved memory ${entry.id} (${content.slice(0,30)}...)`);
      return { text: `Saved memory with id ${entry.id}. Total memories: ${memories.length}` };
    }
  });

  // Tool: delete_memory
  api.tools.register({
    name: 'delete_memory',
    description: 'Delete a permanent memory entry by id. Use when the user asks to forget or remove a memory.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the memory to delete' }
      },
      required: ['id']
    },
    execute: async (args) => {
      const id = String(args.id || '').trim();
      if (!id) throw new Error('id is required');
      let memories = await loadMemories(api);
      const before = memories.length;
      memories = memories.filter(m => m.id !== id);
      if (memories.length === before) throw new Error(`Memory with id ${id} not found`);
      await saveMemories(api, memories);
      await rebuildPrompt(api);
      api.log.info(`deleted memory ${id}`);
      return { text: `Deleted memory ${id}. Remaining memories: ${memories.length}` };
    }
  });

  // Tool: update_memory
  api.tools.register({
    name: 'update_memory',
    description: 'Update an existing permanent memory entry by id. Use when the user wants to change or correct a remembered fact.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the memory to update' },
        content: { type: 'string', description: 'New content (optional, if not provided keeps old)' },
        title: { type: 'string', description: 'New title (optional)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags (optional, replaces old)' }
      },
      required: ['id']
    },
    execute: async (args) => {
      const id = String(args.id || '').trim();
      if (!id) throw new Error('id is required');
      let memories = await loadMemories(api);
      const idx = memories.findIndex(m => m.id === id);
      if (idx === -1) throw new Error(`Memory with id ${id} not found`);
      if (args.content !== undefined) {
        const c = String(args.content).trim();
        if (!c) throw new Error('content cannot be empty');
        if (c.length > MAX_CONTENT_LENGTH) throw new Error(`content too long (max ${MAX_CONTENT_LENGTH})`);
        memories[idx].content = c;
      }
      if (args.title !== undefined) memories[idx].title = String(args.title).trim().slice(0, 100);
      if (args.tags !== undefined) {
        memories[idx].tags = Array.isArray(args.tags) ? args.tags.map(t => String(t).trim().slice(0,30)).filter(Boolean).slice(0,10) : [];
      }
      memories[idx].updatedAt = Date.now();
      await saveMemories(api, memories);
      await rebuildPrompt(api);
      api.log.info(`updated memory ${id}`);
      return { text: `Updated memory ${id}` };
    }
  });

  // Tool: list_memories
  api.tools.register({
    name: 'list_memories',
    description: 'List all permanent memory entries. Use to see what is currently remembered.',
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async () => {
      const memories = await loadMemories(api);
      if (!memories.length) return { text: 'No memories stored.' };
      const lines = memories.map((m, i) => `${i+1}. [${m.id}] ${m.title ? m.title + ': ' : ''}${m.content.slice(0,100)}${m.tags?.length ? ` [tags: ${m.tags.join(',')}]` : ''}`);
      return { text: `Stored memories (${memories.length}):\n` + lines.join('\n') };
    }
  });

  // Tool: search_memories
  api.tools.register({
    name: 'search_memories',
    description: 'Search permanent memories by keyword. Useful to find relevant memories before answering.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    },
    execute: async (args) => {
      const q = String(args.query || '').toLowerCase().trim();
      if (!q) throw new Error('query is required');
      const memories = await loadMemories(api);
      const hits = memories.filter(m => 
        m.content.toLowerCase().includes(q) || 
        (m.title && m.title.toLowerCase().includes(q)) ||
        (m.tags && m.tags.some(t => t.toLowerCase().includes(q)))
      );
      if (!hits.length) return { text: `No memories found for "${args.query}"` };
      const lines = hits.map(m => `[${m.id}] ${m.title ? m.title+': ' : ''}${m.content}`);
      return { text: `Found ${hits.length} memories for "${args.query}":\n` + lines.join('\n') };
    }
  });

  // Listen for config changes to maybe rebuild prompt if needed
  api.log.info('onEnable complete - 5 memory tools registered, prompt active');
}

async function onDisable(api) {
  api.log.info('onDisable - prompt and tools will be auto-removed');
  // Loader will auto-remove prompt and tools, but we can do extra
}

async function onUnload(api) {
  (api || apiRef).log.info('onUnload - permanent memory mod unloading');
}

module.exports = { onLoad, onEnable, onDisable, onUnload };
