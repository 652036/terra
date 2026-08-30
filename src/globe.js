const VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec2 aUv;
  uniform float uYaw;
  uniform float uPitch;
  uniform vec2 uScale;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewNormal;

  vec3 rotateY(vec3 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  }

  vec3 rotateX(vec3 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
  }

  void main() {
    vUv = aUv;
    vWorldNormal = aPosition;
    vViewNormal = rotateX(rotateY(aPosition, uYaw), uPitch);
    gl_Position = vec4(vViewNormal.x * uScale.x, vViewNormal.y * uScale.y, vViewNormal.z * 0.45, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D uTexture;
  uniform float uSunLongitude;
  uniform float uAtmosphere;
  uniform float uGrid;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewNormal;

  void main() {
    vec3 textureColor = texture2D(uTexture, vUv).rgb;
    vec3 sunDirection = normalize(vec3(sin(uSunLongitude), 0.0, cos(uSunLongitude)));
    float sunAmount = dot(normalize(vWorldNormal), sunDirection);
    float daylight = smoothstep(-0.18, 0.22, sunAmount);
    vec3 nightColor = textureColor * vec3(0.10, 0.17, 0.25);
    vec3 dayColor = textureColor * (0.72 + max(sunAmount, 0.0) * 0.48);
    vec3 color = mix(nightColor, dayColor, daylight);

    float longitudeLine = 1.0 - smoothstep(0.0, 0.045, min(fract(vUv.x * 24.0), 1.0 - fract(vUv.x * 24.0)));
    float latitudeLine = 1.0 - smoothstep(0.0, 0.035, min(fract(vUv.y * 12.0), 1.0 - fract(vUv.y * 12.0)));
    float gridLine = max(longitudeLine, latitudeLine) * uGrid;
    color = mix(color, vec3(0.47, 0.83, 0.85), gridLine * 0.38);

    float rim = pow(1.0 - clamp(vViewNormal.z, 0.0, 1.0), 3.0) * uAtmosphere;
    color += vec3(0.18, 0.62, 0.72) * rim * 0.72;
    gl_FragColor = vec4(color, 1.0);
  }
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unable to link globe shaders';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export function createSphereMesh(latitudeSegments = 56, longitudeSegments = 88) {
  const vertices = [];
  const indices = [];
  for (let latIndex = 0; latIndex <= latitudeSegments; latIndex += 1) {
    const latitude = -Math.PI / 2 + (latIndex / latitudeSegments) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    for (let lonIndex = 0; lonIndex <= longitudeSegments; lonIndex += 1) {
      const longitude = -Math.PI + (lonIndex / longitudeSegments) * Math.PI * 2;
      vertices.push(
        cosLatitude * Math.sin(longitude),
        Math.sin(latitude),
        cosLatitude * Math.cos(longitude),
        lonIndex / longitudeSegments,
        1 - latIndex / latitudeSegments,
      );
    }
  }
  const stride = longitudeSegments + 1;
  for (let latIndex = 0; latIndex < latitudeSegments; latIndex += 1) {
    for (let lonIndex = 0; lonIndex < longitudeSegments; lonIndex += 1) {
      const lowerLeft = latIndex * stride + lonIndex;
      const upperLeft = lowerLeft + stride;
      indices.push(lowerLeft, lowerLeft + 1, upperLeft, upperLeft, lowerLeft + 1, upperLeft + 1);
    }
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

function setTexturePixel(gl, texture) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([16, 53, 77, 255]),
  );
}

export class GlobeRenderer {
  constructor(canvas, { textureUrl = './assets/earth-texture.svg', onReady = () => {} } = {}) {
    this.canvas = canvas;
    this.scene = null;
    this.failed = false;
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    if (!this.gl) {
      this.failed = true;
      canvas.dataset.fallback = 'true';
      return;
    }

    try {
      const gl = this.gl;
      this.program = createProgram(gl);
      const mesh = createSphereMesh();
      this.indexCount = mesh.indices.length;
      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      this.indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

      this.texture = gl.createTexture();
      setTexturePixel(gl, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.locations = {
        position: gl.getAttribLocation(this.program, 'aPosition'),
        uv: gl.getAttribLocation(this.program, 'aUv'),
        yaw: gl.getUniformLocation(this.program, 'uYaw'),
        pitch: gl.getUniformLocation(this.program, 'uPitch'),
        scale: gl.getUniformLocation(this.program, 'uScale'),
        sunLongitude: gl.getUniformLocation(this.program, 'uSunLongitude'),
        atmosphere: gl.getUniformLocation(this.program, 'uAtmosphere'),
        grid: gl.getUniformLocation(this.program, 'uGrid'),
        texture: gl.getUniformLocation(this.program, 'uTexture'),
      };

      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(canvas);

      const image = new Image();
      image.addEventListener('load', () => {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        this.draw();
        onReady();
      });
      image.addEventListener('error', () => {
        canvas.dataset.texture = 'unavailable';
        this.draw();
      });
      image.src = textureUrl;
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        canvas.dataset.fallback = 'true';
      });
    } catch (error) {
      console.warn('WebGL globe unavailable; retaining the CSS fallback.', error);
      this.failed = true;
      canvas.dataset.fallback = 'true';
    }
  }

  render(scene) {
    this.scene = scene;
    this.draw();
  }

  draw() {
    if (this.failed || !this.scene || !this.gl) return;
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.uv, 2, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(this.locations.uv);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    const camera = this.scene.camera;
    const altitude = Math.max(0.72, Math.min(1.55, Number(camera.altitude) || 1));
    const baseScale = Math.min(0.9, 0.82 / altitude);
    const aspect = width / height;
    const scaleX = aspect >= 1 ? baseScale / aspect : baseScale;
    const scaleY = aspect >= 1 ? baseScale : baseScale * aspect;
    gl.uniform1f(this.locations.yaw, (-camera.lon * Math.PI) / 180);
    gl.uniform1f(this.locations.pitch, (camera.lat * Math.PI) / 180);
    gl.uniform2f(this.locations.scale, scaleX, scaleY);
    gl.uniform1f(this.locations.sunLongitude, (((12 - this.scene.time) * 15) * Math.PI) / 180);
    gl.uniform1f(this.locations.atmosphere, this.scene.layers.atmosphere ? 1 : 0);
    gl.uniform1f(this.locations.grid, this.scene.layers.grid ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.locations.texture, 0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  dispose() {
    this.resizeObserver?.disconnect();
    if (!this.gl) return;
    this.gl.deleteBuffer(this.vertexBuffer);
    this.gl.deleteBuffer(this.indexBuffer);
    this.gl.deleteTexture(this.texture);
    this.gl.deleteProgram(this.program);
  }
}
