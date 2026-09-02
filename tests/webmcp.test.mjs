import test from 'node:test';
import assert from 'node:assert/strict';
import { getModelContext, installWebMCP, isEmbeddedFrame, schemas, validateInput } from '../src/webmcp.js';

const tool = (name, result, extra = {}) => ({
  name,
  description: `${name} test tool.`,
  inputSchema: schemas.empty,
  execute: async () => result,
  ...extra,
});

test('strict input validation rejects wrong, unknown, duplicate, and malformed values', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['ids', 'hour'],
    properties: {
      ids: { type: 'array', minItems: 2, uniqueItems: true, items: schemas.id },
      hour: { type: 'integer', minimum: 0, maximum: 23 },
    },
  };
  assert.equal(validateInput(schema, { ids: ['tokyo', 'vancouver'], hour: 22 }), true);
  assert.throws(() => validateInput(schema, { ids: ['tokyo', 'tokyo'], hour: 22 }), /unique/);
  assert.throws(() => validateInput(schema, { ids: ['Tokyo!', 'vancouver'], hour: 22 }), /format; it must match \^\[A-Za-z0-9\]/);
  assert.throws(() => validateInput(schema, { ids: ['tokyo', 'vancouver'], hour: 24 }), /at most/);
  assert.throws(() => validateInput(schema, { ids: ['tokyo', 'vancouver'], hour: 22, extra: true }), /not allowed/);
});

test('id schema is loose enough for city names while code stays strict', () => {
  assert.equal(validateInput(schemas.id, 'New York'), true);
  assert.equal(validateInput(schemas.id, 'Tokyo'), true);
  assert.equal(validateInput(schemas.id, 'pin-tokyo'), true);
  assert.throws(() => validateInput(schemas.id, ' leading space'), /format/);
  assert.throws(() => validateInput(schemas.id, 'tokyo;drop'), /format/);
  assert.throws(() => validateInput(schemas.id, ''), /too short \(minimum 1 character\)/);
  assert.throws(() => validateInput(schemas.shortText, 'x'.repeat(161)), /too long \(161 characters; maximum 160\)/);
});

test('native registration is awaited, returns one raw object, and publish aborts only the mutation group', async () => {
  const originalDocument = globalThis.document;
  const registrations = [];
  globalThis.document = {
    modelContext: {
      async registerTool(definition, options) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        registrations.push({ definition, options });
      },
    },
  };
  const read = tool('terra_test_read', { ok: true }, { annotations: { readOnlyHint: true } });
  const write = tool('terra_test_write', { wrote: true });
  const groups = { always: [read], mutation: [write] };
  try {
    const statuses = [];
    const draft = await installWebMCP(groups, { namespace: '__terraTestOne', onStatus: (status) => statuses.push(status) });
    assert.equal(draft.mode, 'native');
    assert.equal(draft.toolCount, 2);
    assert.equal(draft.published, false);
    assert.deepEqual(statuses.at(-1), { mode: 'native', toolCount: 2, published: false, message: 'Native WebMCP connected' });
    assert.deepEqual(registrations.map((entry) => entry.definition.name), ['terra_test_read', 'terra_test_write']);
    assert.equal(registrations[0].options.signal.aborted, false);
    assert.equal(registrations[1].options.signal.aborted, false);
    const nativeResult = await registrations[0].definition.execute({});
    assert.deepEqual(nativeResult, { ok: true });
    assert.equal('content' in nativeResult, false);
    assert.equal('structuredContent' in nativeResult, false);
    await assert.rejects(() => registrations[0].definition.execute({ unexpected: true }), /not allowed/);
    assert.deepEqual(globalThis.__terraTestOne.status(), { mode: 'native', toolCount: 2, published: false });

    const published = await installWebMCP(groups, { namespace: '__terraTestOne', published: true });
    assert.equal(published.mode, 'native');
    assert.equal(published.toolCount, 1);
    assert.equal(published.published, true);
    assert.equal(registrations.length, 2, 'publishing must not re-register the read-only group');
    assert.equal(registrations[0].options.signal.aborted, false, 'read-only group survives publish');
    assert.equal(registrations[1].options.signal.aborted, true, 'mutation group is aborted on publish');
    assert.deepEqual(globalThis.__terraTestOne.listTools().map((item) => item.name), ['terra_test_read']);
    await assert.rejects(() => globalThis.__terraTestOne.executeTool('terra_test_write', {}), /Unknown tool "terra_test_write"\. Available tools: terra_test_read\./);
    assert.deepEqual(globalThis.__terraTestOne.status(), { mode: 'native', toolCount: 1, published: true });

    const reopened = await installWebMCP(groups, { namespace: '__terraTestOne', published: false });
    assert.equal(reopened.toolCount, 2);
    assert.deepEqual(registrations.map((entry) => entry.definition.name), ['terra_test_read', 'terra_test_write', 'terra_test_write']);
    assert.equal(registrations[0].options.signal.aborted, false, 'read-only group is still the original registration');
    assert.equal(registrations[2].options.signal.aborted, false);

    await installWebMCP({ always: [tool('terra_test_other_read', {})], mutation: [] }, { namespace: '__terraTestTwo' });
    assert.equal(registrations[0].options.signal.aborted, true, 'a different read-only set replaces the old group');
    assert.equal(registrations[2].options.signal.aborted, true);
    assert.equal(registrations.at(-1).definition.name, 'terra_test_other_read');
    assert.equal(registrations.at(-1).options.signal.aborted, false);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('concurrent installs are serialized so groups never interleave', async () => {
  const originalDocument = globalThis.document;
  const order = [];
  globalThis.document = {
    modelContext: {
      async registerTool(definition, options) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        order.push({ name: definition.name, signal: options.signal });
      },
    },
  };
  try {
    const groups = { always: [tool('terra_serial_read', {})], mutation: [tool('terra_serial_write', {})] };
    const [first, second] = await Promise.all([
      installWebMCP(groups, { namespace: '__terraSerial', published: false }),
      installWebMCP(groups, { namespace: '__terraSerial', published: true }),
    ]);
    assert.equal(first.mode, 'superseded');
    assert.equal(second.mode, 'native');
    assert.deepEqual(order.map((entry) => entry.name), ['terra_serial_read', 'terra_serial_write']);
    assert.equal(order[0].signal.aborted, false);
    assert.equal(order[1].signal.aborted, true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('modelContext is read from document first and navigator second', async () => {
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  try {
    globalThis.document = {};
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
    assert.equal(getModelContext(), null);
    const navigatorContext = { async registerTool() {} };
    Object.defineProperty(globalThis, 'navigator', { value: { modelContext: navigatorContext }, configurable: true, writable: true });
    assert.equal(getModelContext(), navigatorContext);
    const documentContext = { async registerTool() {} };
    globalThis.document = { modelContext: documentContext };
    assert.equal(getModelContext(), documentContext);

    let registered = 0;
    navigatorContext.registerTool = async () => { registered += 1; };
    globalThis.document = {};
    const result = await installWebMCP({ always: [tool('terra_nav_read', {})], mutation: [] }, { namespace: '__terraNav' });
    assert.equal(result.mode, 'native');
    assert.equal(registered, 1);
  } finally {
    globalThis.document = originalDocument;
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true, writable: true });
  }
});

test('toolchange events refresh the badge from getTools() when the browser supports them', async () => {
  const originalDocument = globalThis.document;
  const listeners = new Map();
  let exposed = [];
  const context = {
    async registerTool() {},
    addEventListener(type, handler) { listeners.set(type, handler); },
    getTools() { return exposed; },
  };
  globalThis.document = { modelContext: context };
  try {
    const statuses = [];
    await installWebMCP(
      { always: [tool('terra_change_read', {})], mutation: [tool('terra_change_write', {})] },
      { namespace: '__terraChange', onStatus: (status) => statuses.push(status) },
    );
    assert.equal(statuses.at(-1).toolCount, 2);
    assert.ok(listeners.has('toolchange'));
    exposed = [{ name: 'terra_change_read' }];
    listeners.get('toolchange')();
    assert.deepEqual(statuses.at(-1), { mode: 'native', toolCount: 1, published: false, message: 'Native WebMCP connected' });
    exposed = 'not-an-array';
    listeners.get('toolchange')();
    assert.equal(statuses.length, 2, 'non-array getTools() results are ignored');
    await installWebMCP({ always: [tool('terra_change_read', {})], mutation: [] }, { namespace: '__terraChange', onStatus: (status) => statuses.push(status) });
    assert.equal(listeners.size, 1, 'the listener is bound once per context');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('embedded frames never register native tools even when modelContext exists', async () => {
  const originalDocument = globalThis.document;
  const originalTop = globalThis.top;
  const originalSelf = globalThis.self;
  let registrations = 0;
  globalThis.document = { modelContext: { async registerTool() { registrations += 1; } } };
  globalThis.self = globalThis;
  globalThis.top = {};
  try {
    assert.equal(isEmbeddedFrame(), true);
    const statuses = [];
    const result = await installWebMCP(
      { always: [tool('terra_frame_test', { framed: true })], mutation: [] },
      { namespace: '__terraFrameTest', onStatus: (status) => statuses.push(status) },
    );
    assert.equal(result.mode, 'preview');
    assert.equal(registrations, 0);
    assert.equal(statuses.at(-1).message, 'Embedded frame: native tools disabled');
    assert.deepEqual(await globalThis.__terraFrameTest.executeTool('terra_frame_test', {}), { framed: true });
    globalThis.top = globalThis;
    assert.equal(isEmbeddedFrame(), false);
  } finally {
    globalThis.document = originalDocument;
    globalThis.top = originalTop;
    globalThis.self = originalSelf;
  }
});

test('registration failures abort both native groups and activate preview', async () => {
  const originalDocument = globalThis.document;
  const originalWarn = console.warn;
  const signals = [];
  console.warn = () => {};
  globalThis.document = {
    modelContext: {
      async registerTool(_definition, options) {
        signals.push(options.signal);
        if (signals.length === 2) throw new DOMException('Denied', 'NotAllowedError');
      },
    },
  };
  try {
    let fallbackSignal;
    const result = await installWebMCP({
      always: [{
        name: 'terra_one',
        description: 'One.',
        inputSchema: schemas.empty,
        execute: async (_input, { signal }) => {
          fallbackSignal = signal;
          return {};
        },
      }],
      mutation: [tool('terra_two', {})],
    }, { namespace: '__terraFailureTest' });
    assert.equal(result.mode, 'preview');
    assert.equal(signals.length, 2);
    assert.equal(signals[0].aborted, true, 'read-only group is aborted when the mutation group fails');
    assert.equal(signals[1].aborted, true);
    assert.deepEqual(await globalThis.__terraFailureTest.executeTool('terra_one', {}), {});
    assert.equal(fallbackSignal.aborted, false);
  } finally {
    globalThis.document = originalDocument;
    console.warn = originalWarn;
  }
});
