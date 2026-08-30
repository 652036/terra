import test from 'node:test';
import assert from 'node:assert/strict';
import { createSphereMesh } from '../src/globe.js';

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
