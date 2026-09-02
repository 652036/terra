import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobeRenderer, VERTEX_SHADER, createSphereMesh } from '../src/globe.js';

test('sphere mesh contains valid 3D positions, UVs, and triangles', () => {
  const latitudeSegments = 8;
  const longitudeSegments = 12;
  const mesh = createSphereMesh(latitudeSegments, longitudeSegments);
  assert.equal(mesh.vertices.length, (latitudeSegments + 1) * (longitudeSegments + 1) * 5);
  assert.equal(mesh.indices.length, latitudeSegments * longitudeSegments * 6);
  assert.ok([...mesh.vertices].every(Number.isFinite));
  const vertexCount = mesh.vertices.length / 5;
  assert.ok([...mesh.indices].every((index) => index >= 0 && index < vertexCount));

  for (let index = 0; index < mesh.vertices.length; index += 5) {
    const radius = Math.hypot(mesh.vertices[index], mesh.vertices[index + 1], mesh.vertices[index + 2]);
    assert.ok(Math.abs(radius - 1) < 1e-5);
    assert.ok(mesh.vertices[index + 3] >= 0 && mesh.vertices[index + 3] <= 1);
    assert.ok(mesh.vertices[index + 4] >= 0 && mesh.vertices[index + 4] <= 1);
  }
});

test('vertex shader writes viewer-facing geometry to the near side of the depth range', () => {
  assert.match(VERTEX_SHADER, /gl_Position = vec4\([^;]*-vViewNormal\.z \* 0\.45, 1\.0\);/);
});

function fakeCanvas({ webgl = true } = {}) {
  const listeners = new Map();
  const gl = {
    lost: false,
    isContextLost() { return this.lost; },
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    createProgram: () => ({}),
    attachShader() {},
    linkProgram() {},
    deleteShader() {},
    getProgramParameter: () => true,
    createBuffer: () => ({}),
    bindBuffer() {},
    bufferData() {},
    createTexture: () => ({}),
    bindTexture() {},
    texImage2D() {},
    texParameteri() {},
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    viewport() {},
    clearColor() {},
    clear() {},
    enable() {},
    cullFace() {},
    useProgram() {},
    vertexAttribPointer() {},
    enableVertexAttribArray() {},
    uniform1f() {},
    uniform2f() {},
    uniform1i() {},
    activeTexture() {},
    drawElements() { this.draws = (this.draws ?? 0) + 1; },
  };
  const canvas = {
    dataset: {},
    width: 0,
    height: 0,
    getContext: () => (webgl ? gl : null),
    getBoundingClientRect: () => ({ width: 300, height: 200 }),
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatch(type) { listeners.get(type)?.({ preventDefault() {} }); },
  };
  return { canvas, gl };
}

test('renderer stops drawing when the WebGL context is lost and rebuilds on restore', () => {
  const originalImage = globalThis.Image;
  globalThis.Image = class { addEventListener() {} set src(_value) {} };
  try {
    const { canvas, gl } = fakeCanvas();
    const renderer = new GlobeRenderer(canvas, { textureUrl: 'x.svg' });
    const scene = { camera: { lat: 0, lon: 0, altitude: 1 }, time: 13, layers: { atmosphere: true, grid: false } };
    renderer.render(scene);
    assert.equal(gl.draws, 1);
    assert.equal(canvas.dataset.fallback, undefined);

    const programBefore = renderer.program;
    canvas.dispatch('webglcontextlost');
    assert.equal(renderer.failed, true);
    assert.equal(canvas.dataset.fallback, 'true');
    renderer.render(scene);
    assert.equal(gl.draws, 1, 'draw() returns early while the context is lost');

    canvas.dispatch('webglcontextrestored');
    assert.equal(renderer.failed, false);
    assert.equal(canvas.dataset.fallback, undefined);
    assert.notEqual(renderer.program, programBefore, 'GPU resources are recreated');
    assert.equal(gl.draws, 2);
  } finally {
    globalThis.Image = originalImage;
  }
});

test('renderer falls back to CSS when WebGL is unavailable', () => {
  const { canvas } = fakeCanvas({ webgl: false });
  const renderer = new GlobeRenderer(canvas);
  assert.equal(renderer.failed, true);
  assert.equal(canvas.dataset.fallback, 'true');
  renderer.render({ camera: { lat: 0, lon: 0, altitude: 1 }, time: 13, layers: {} });
});
