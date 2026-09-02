function typeMatches(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'null') return value === null;
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

export function validateInput(schema = { type: 'object' }, value, path = 'input') {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => typeMatches(value, type))) {
    throw new TypeError(`${path} must be ${types.join(' or ')}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new RangeError(`${path} must be one of: ${schema.enum.join(', ')}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) throw new RangeError(`${path} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new RangeError(`${path} must be at most ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new RangeError(`${path} is too short (minimum ${schema.minLength} character${schema.minLength === 1 ? '' : 's'})`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new RangeError(`${path} is too long (${value.length} characters; maximum ${schema.maxLength})`);
    }
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern).test(value))) {
      throw new RangeError(`${path} has an invalid format; it must match ${schema.pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new RangeError(`${path} needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new RangeError(`${path} allows at most ${schema.maxItems} item(s)`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      throw new RangeError(`${path} must contain unique items`);
    }
    if (schema.items) value.forEach((item, index) => validateInput(schema.items, item, `${path}[${index}]`));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!(required in value)) throw new TypeError(`${path}.${required} is required`);
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find((key) => !(key in properties));
      if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) validateInput(child, value[key], `${path}.${key}`);
    }
  }
  return true;
}

// Two native registration groups: the read-only group lives for the whole page; the mutation
// group is aborted on publish and re-registered on reopen.
const native = {
  alwaysController: null,
  alwaysKey: null,
  mutationController: null,
};
let previewController = null;
let requestedInstallation = 0;
let activeMode = 'preview';
let installQueue = Promise.resolve();

export function getModelContext() {
  return globalThis.document?.modelContext ?? globalThis.navigator?.modelContext ?? null;
}

let toolchangeTarget = null;
let latestStatus = null;

// Some builds expose a `toolchange` event and `getTools()`; when present, the badge follows the
// browser's own view of the registered tool count.
function watchToolChanges(context, onStatus, published) {
  latestStatus = { context, onStatus, published };
  if (toolchangeTarget === context || typeof context.addEventListener !== 'function') return;
  toolchangeTarget = context;
  context.addEventListener('toolchange', () => {
    if (!latestStatus || latestStatus.context !== context || activeMode !== 'native') return;
    let tools;
    try {
      tools = typeof context.getTools === 'function' ? context.getTools() : undefined;
    } catch {
      return;
    }
    if (!Array.isArray(tools)) return;
    latestStatus.onStatus({ mode: 'native', toolCount: tools.length, published: latestStatus.published, message: 'Native WebMCP connected' });
  });
}

export function isEmbeddedFrame() {
  try {
    return globalThis.top !== undefined && globalThis.top !== globalThis.self;
  } catch {
    return true;
  }
}

function abortNativeGroups() {
  native.alwaysController?.abort();
  native.mutationController?.abort();
  native.alwaysController = null;
  native.alwaysKey = null;
  native.mutationController = null;
}

function nativeDefinition(tool, controller) {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    execute: async (input = {}, options = {}) => {
      validateInput(tool.inputSchema ?? { type: 'object' }, input ?? {});
      if (options.signal?.aborted) throw new DOMException('Tool call was cancelled.', 'AbortError');
      return tool.execute(input ?? {}, {
        signal: options.signal ?? controller.signal,
      });
    },
  };
}

async function registerGroup(context, tools, controller) {
  for (const tool of tools) {
    await context.registerTool(nativeDefinition(tool, controller), { signal: controller.signal });
  }
}

async function install({ always = [], mutation = [] }, { onStatus, namespace, published, ticket }) {
  const tools = published ? [...always] : [...always, ...mutation];
  previewController?.abort();
  previewController = new AbortController();
  const preview = previewController;

  const execute = async (name, input = {}) => {
    const tool = tools.find((item) => item.name === name);
    if (!tool) throw new Error(`Unknown tool "${name}". Available tools: ${tools.map((item) => item.name).join(', ')}.`);
    validateInput(tool.inputSchema ?? { type: 'object' }, input);
    return tool.execute(input, { signal: preview.signal });
  };

  globalThis[namespace] = {
    listTools: () => tools.map(({ execute: _execute, ...tool }) => tool),
    executeTool: execute,
    status: () => ({ mode: activeMode, toolCount: tools.length, published }),
  };

  const superseded = () => ({ mode: 'superseded', toolCount: 0, published, execute });
  const finish = (mode, message, extra = {}) => {
    if (ticket !== requestedInstallation) return superseded();
    activeMode = mode;
    onStatus({ mode, toolCount: tools.length, published, message, ...extra });
    return { mode, toolCount: tools.length, published, execute };
  };

  if (isEmbeddedFrame()) {
    abortNativeGroups();
    return finish('preview', 'Embedded frame: native tools disabled');
  }

  const context = getModelContext();
  if (!context?.registerTool) {
    abortNativeGroups();
    return finish('preview', 'Tool Lab preview');
  }

  try {
    const alwaysKey = always.map((tool) => tool.name).join('|');
    if (!native.alwaysController || native.alwaysController.signal.aborted || native.alwaysKey !== alwaysKey) {
      native.alwaysController?.abort();
      native.alwaysController = new AbortController();
      native.alwaysKey = alwaysKey;
      await registerGroup(context, always, native.alwaysController);
    }
    native.mutationController?.abort();
    native.mutationController = null;
    if (!published) {
      native.mutationController = new AbortController();
      await registerGroup(context, mutation, native.mutationController);
    }
    watchToolChanges(context, onStatus, published);
    return finish('native', 'Native WebMCP connected');
  } catch (error) {
    abortNativeGroups();
    if (ticket !== requestedInstallation) return superseded();
    console.warn('Native WebMCP registration failed; using Tool Lab preview.', error);
    return finish('preview', 'Preview fallback active', { error });
  }
}

export function installWebMCP(groups, { onStatus = () => {}, namespace = '__terraWebMCP', published = false } = {}) {
  const ticket = ++requestedInstallation;
  const run = installQueue.then(() => install(groups, { onStatus, namespace, published, ticket }));
  installQueue = run.catch(() => {});
  return run;
}

export const schemas = {
  empty: { type: 'object', properties: {}, additionalProperties: false },
  // Loose in the schema, strict in code: handlers resolve ids or city names and reply with the valid list.
  id: {
    type: 'string',
    minLength: 1,
    maxLength: 120,
    pattern: '^[A-Za-z0-9][A-Za-z0-9 -]*$',
    description: 'Stable TERRA id such as tokyo or pin-tokyo. Place parameters also accept a city name such as "New York".',
  },
  shortText: {
    type: 'string',
    minLength: 1,
    maxLength: 160,
    description: 'Plain text, 1 to 160 characters.',
  },
  longText: {
    type: 'string',
    minLength: 1,
    maxLength: 4000,
    description: 'Plain text, 1 to 4,000 characters, displayed to the person as untrusted content.',
  },
};
