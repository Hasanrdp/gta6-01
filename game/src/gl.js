// WebGL2 core: one shader program (per-vertex colour, lambert sun, distance
// fog), one unit-box mesh, and a static batch builder. Everything in the city
// is a box; the static city is baked into two big buffers at load, and cars,
// people and markers are drawn as single boxes per frame.
const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
uniform mat4 uMVP;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vColor;
out float vDist;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 view = uMVP * world;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vDist = -view.z;
  gl_Position = view;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec3 vColor;
in float vDist;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uBright;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uSunDir)), 0.0);
  float light = 0.55 + 0.45 * diff;
  vec3 col = vColor * light * uBright;
  float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, f * 0.85);
  outColor = vec4(col, 1.0);
}`;

// A unit box centred on the origin, 1x1x1, with outward normals. Faces are
// wound counter-clockwise seen from outside.
const BOX_POS = [
  // +x
  0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
  // -x
  -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
  // +y
  -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  // -y
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5,
  // +z
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  // -z
  0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
];
const BOX_NORM = [
  1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
];

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is required');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`program: ${gl.getProgramInfoLog(prog)}`);
  }
  gl.useProgram(prog);
  const loc = {
    mvp: gl.getUniformLocation(prog, 'uMVP'),
    model: gl.getUniformLocation(prog, 'uModel'),
    sun: gl.getUniformLocation(prog, 'uSunDir'),
    fogColor: gl.getUniformLocation(prog, 'uFogColor'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    bright: gl.getUniformLocation(prog, 'uBright'),
  };
  // Unit box mesh (shared by every dynamic draw).
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(BOX_POS), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const normBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(BOX_NORM), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  const colorBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0.98, 0.62, 0.42, 1);
  return { gl, prog, loc, vao, colorBuf };
}

/** A builder for one static draw call: accumulate coloured boxes, bake once. */
export function createBatch(glCtx) {
  const positions = [];
  const normals = [];
  const colors = [];
  return {
    box(cx, cy, cz, sx, sy, sz, color) {
      for (let i = 0; i < 36; i++) {
        positions.push(
          cx + BOX_POS[i * 3] * sx,
          cy + BOX_POS[i * 3 + 1] * sy,
          cz + BOX_POS[i * 3 + 2] * sz,
        );
        normals.push(BOX_NORM[i * 3], BOX_NORM[i * 3 + 1], BOX_NORM[i * 3 + 2]);
        colors.push(color[0], color[1], color[2]);
      }
    },
    bake() {
      const { gl } = glCtx;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const mk = (data, loc) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      };
      mk(positions, 0);
      mk(normals, 1);
      mk(colors, 2);
      return { vao, count: positions.length / 3 };
    },
  };
}

export function drawBatch(glCtx, batch, mvp, model) {
  const { gl, loc } = glCtx;
  gl.bindVertexArray(batch.vao);
  gl.uniformMatrix4fv(loc.mvp, false, mvp);
  gl.uniformMatrix4fv(loc.model, false, model);
  gl.uniform1f(loc.bright, 1);
  gl.drawArrays(gl.TRIANGLES, 0, batch.count);
}

/** Draw one coloured unit box with a model matrix (dynamic objects). */
export function drawBox(glCtx, mvp, model, color, bright = 1) {
  const { gl, loc, vao, colorBuf } = glCtx;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
  const c = new Float32Array(36 * 3);
  for (let i = 0; i < 36; i++) {
    c[i * 3] = color[0];
    c[i * 3 + 1] = color[1];
    c[i * 3 + 2] = color[2];
  }
  gl.bufferData(gl.ARRAY_BUFFER, c, gl.DYNAMIC_DRAW);
  gl.uniformMatrix4fv(loc.mvp, false, mvp);
  gl.uniformMatrix4fv(loc.model, false, model);
  gl.uniform1f(loc.bright, bright);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
}
