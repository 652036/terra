import test from 'node:test';
import assert from 'node:assert/strict';
import { installWebMCP, schemas, validateInput } from '../src/webmcp.js';

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
  assert.throws(() => validateInput(schema, { ids: ['Tokyo!', 'vancouver'], hour: 22 }), /format/);
  assert.throws(() => validateInput(schema, { ids: ['tokyo', 'vancouver'], hour: 24 }), /at most/);
  assert.throws(() => validateInput(schema, { ids: ['tokyo', 'vancouver'], hour: 22, extra: true }), /not allowed/);
});

test('native registration is awaited, returns one raw object, and aborts on reconnect', async () => {
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
  try {
    const first = await installWebMCP([{
      name: 'terra_test_read',
      description: 'Test tool.',
      inputSchema: schemas.empty,
      annotations: { readOnlyHint: true },
      execute: async () => ({ ok: true }),
    }], { namespace: '__terraTestOne' });
    assert.equal(first.mode, 'native');
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].options.signal.aborted, false);
    const nativeResult = await registrations[0].definition.execute({});
    assert.deepEqual(nativeResult, { ok: true });
    assert.equal('content' in nativeResult, false);
    assert.equal('structuredContent' in nativeResult, false);
    await assert.rejects(() => registrations[0].definition.execute({ unexpected: true }), /not allowed/);

    await installWebMCP([{
      name: 'terra_test_second',
      description: 'Second test tool.',
      inputSchema: schemas.empty,
      execute: async () => ({ second: true }),
    }], { namespace: '__terraTestTwo' });
    assert.equal(registrations[0].options.signal.aborted, true);
    assert.equal(registrations[1].options.signal.aborted, false);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('registration failures abort partial native tools and activate preview', async () => {
  const originalDocument = globalThis.document;
  const originalWarn = console.warn;
  let firstSignal;
  let calls = 0;
  console.warn = () => {};
  globalThis.document = {
    modelContext: {
      async registerTool(_definition, options) {
        calls += 1;
        firstSignal ??= options.signal;
        if (calls === 2) throw new DOMException('Denied', 'NotAllowedError');
      },
    },
  };
  try {
    let fallbackSignal;
    const result = await installWebMCP([
      {
        name: 'terra_one',
        description: 'One.',
        inputSchema: schemas.empty,
        execute: async (_input, { signal }) => {
          fallbackSignal = signal;
          return {};
        },
      },
      { name: 'terra_two', description: 'Two.', inputSchema: schemas.empty, execute: async () => ({}) },
    ], { namespace: '__terraFailureTest' });
    assert.equal(result.mode, 'preview');
    assert.equal(firstSignal.aborted, true);
    assert.deepEqual(await globalThis.__terraFailureTest.executeTool('terra_one', {}), {});
    assert.equal(fallbackSignal.aborted, false);
  } finally {
    globalThis.document = originalDocument;
    console.warn = originalWarn;
  }
});
