// WebGL2 render engine for the Video Effects tool.
//
// One engine instance owns the effect <canvas> and reads frames from the
// shared <video> element (the same element shown on the left, so the two sides
// are always in sync). Each frame runs the active effect CHAIN: every enabled
// effect renders into an intermediate texture that becomes the next effect's
// input (u_tex), and the last output is blitted to the canvas. Per-effect
// pipelines:
//
//   simple     one fragment shader, input in → output out
//   history    keeps a ring of the effect's past INPUT frames in a grid atlas
//              (hist(uv, framesBack) in the shader samples it)
//   feedback   the effect's previous OUTPUT frame is fed back in as u_prev
//   flow       feedback + the effect's previous input frame as u_prevTex
//   sim        a ping-pong simulation buffer (reaction-diffusion) stepped
//              several times per frame, then a display shader
//   particles  particle state (pos/vel) lives in a float ping-pong texture,
//              updated in a shader and drawn as point sprites
//
// Stateful resources (atlas, feedback, sim, particles) are allocated PER
// EFFECT, keyed by effect id, so chained effects never share state. Effects
// declare per-param uniforms (u_<key>) that are set from the UI values on
// every draw, so slider tweaks are visible immediately, even while paused.
//
// Two drive modes:
//  - live preview: pass the <video> element; a rAF loop follows its clock.
//  - manual/offline (video = null): no loop — the caller drives it with
//    setExportSize() + pushFrame(source, timeSec), one deterministic frame
//    at a time (used by the export pipeline; `source` is any TexImageSource,
//    typically a WebCodecs VideoFrame).

import {
  createProgram,
  createTexture,
  createTarget,
  deleteTarget,
  createFullscreenQuad,
  hexToRgb,
} from './gl.js';

const MAX_SIDE = 1280; // preview canvas resolution cap (export mode: none)

// History atlas: HGRID x HGRID cells of past frames in one texture.
const HGRID = 5;
const HFRAMES = HGRID * HGRID;
const HCELL = 400;
const HATLAS = HGRID * HCELL;

const SIM_RES = 512; // reaction-diffusion buffer
const PARTICLE_DIM = 256; // 256² = 65 536 particle slots

const VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const HEADER = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform vec2 u_texRes;
uniform float u_time;
in vec2 v_uv;
out vec4 outColor;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
`;

const HIST_CHUNK = `
uniform sampler2D u_hist;
uniform float u_histHead;
uniform float u_histLen;
const float HGRID = ${HGRID}.0;
vec4 hist(vec2 uv, float back){
  back = clamp(floor(back), 0.0, max(u_histLen - 1.0, 0.0));
  float idx = mod(u_histHead - back + HGRID * HGRID * 8.0, HGRID * HGRID);
  vec2 cell = vec2(mod(idx, HGRID), floor(idx / HGRID));
  vec2 auv = (cell + clamp(uv, 0.002, 0.998)) / HGRID;
  return texture(u_hist, auv);
}
`;

const PASS_FRAG =
  HEADER +
  `uniform float u_gain;
void main(){ outColor = vec4(texture(u_tex, v_uv).rgb * u_gain, 1.0); }`;

const PARTICLE_VERT = `#version 300 es
precision highp float;
uniform sampler2D u_state;
uniform sampler2D u_tex;
uniform float u_stateDim;
uniform float u_pointSize;
out vec3 v_col;
void main(){
  int dim = int(u_stateDim);
  ivec2 ij = ivec2(gl_VertexID % dim, gl_VertexID / dim);
  vec4 s = texelFetch(u_state, ij, 0);
  v_col = textureLod(u_tex, s.xy, 0.0).rgb;
  gl_Position = vec4(s.xy * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = u_pointSize;
}`;

const PARTICLE_FRAG = `#version 300 es
precision highp float;
in vec3 v_col;
out vec4 outColor;
void main(){
  float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5));
  outColor = vec4(v_col, a);
}`;

export class EffectEngine {
  constructor(canvas, video, opts = {}) {
    this.canvas = canvas;
    this.video = video || null;
    this.maxSide = opts.maxSide ?? (video ? MAX_SIDE : Infinity);
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    // Float render targets are needed by the simulation/particle effects.
    this.floatOk = !!gl.getExtension('EXT_color_buffer_float');
    this.halfOk = this.floatOk || !!gl.getExtension('EXT_color_buffer_half_float');
    this.floatLinearOk = !!gl.getExtension('OES_texture_float_linear');

    this.quad = createFullscreenQuad(gl);
    // Attribute-less VAO for the particle point draw (positions come from
    // gl_VertexID + the state texture, so no vertex buffer may be enabled).
    this.emptyVao = gl.createVertexArray();
    this.programs = new Map(); // effect id -> { main, sim, update, draw }
    this.passProg = this.buildProgram(VERT, PASS_FRAG);

    // Two video textures, uploaded alternately, so the previous source frame
    // is always available.
    this.videoTex = [this.makeVideoTexture(), this.makeVideoTexture()];
    this.parity = 0;
    this.hasFrame = false;
    this.lastVideoTime = -1;

    this.effects = []; // active chain: [{ def, values }] in render order
    this.fxState = new Map(); // effect id -> per-effect stateful resources
    this.chainTargets = null; // two canvas-size ping-pong targets for stages

    this.width = 0;
    this.height = 0;
    this.srcW = 2;
    this.srcH = 2;
    this.t0 = performance.now();
    this.disposed = false;
    this.frame = this.frame.bind(this);
    this.raf = this.video ? requestAnimationFrame(this.frame) : 0;
  }

  // -- setup helpers --------------------------------------------------------

  buildProgram(vert, frag) {
    return { prog: createProgram(this.gl, vert, frag), locs: {} };
  }

  loc(rec, name) {
    if (!(name in rec.locs)) rec.locs[name] = this.gl.getUniformLocation(rec.prog, name);
    return rec.locs[name];
  }

  makeVideoTexture() {
    return createTexture(this.gl, 2, 2);
  }

  floatTargetOpts() {
    const gl = this.gl;
    if (this.floatOk) return { internalFormat: gl.RGBA32F, type: gl.FLOAT };
    if (this.halfOk) return { internalFormat: gl.RGBA16F, type: gl.HALF_FLOAT };
    return {}; // RGBA8 fallback — degraded but functional
  }

  getEffectPrograms(def) {
    let rec = this.programs.get(def.id);
    if (rec) return rec;
    const chunk = def.type === 'history' ? HIST_CHUNK : '';
    rec = {
      main: def.frag ? this.buildProgram(VERT, HEADER + chunk + def.frag) : null,
      sim: def.simFrag ? this.buildProgram(VERT, HEADER + def.simFrag) : null,
      update: def.updateFrag ? this.buildProgram(VERT, HEADER + def.updateFrag) : null,
      draw: def.type === 'particles' ? this.buildProgram(PARTICLE_VERT, PARTICLE_FRAG) : null,
    };
    this.programs.set(def.id, rec);
    return rec;
  }

  // Per-effect stateful resources, created lazily and kept while the effect
  // stays in the chain (so trails/history survive param tweaks).
  getFx(id) {
    let fx = this.fxState.get(id);
    if (!fx) {
      fx = {
        resetNeeded: true,
        atlas: null,
        histHead: 0,
        histLen: 0,
        fb: null, // feedback ping-pong [read, write]
        prevInput: null, // flow: this effect's input from the previous frame
        sim: null,
        particles: null,
      };
      this.fxState.set(id, fx);
    }
    return fx;
  }

  disposeFx(fx) {
    const gl = this.gl;
    if (fx.atlas) deleteTarget(gl, fx.atlas);
    if (fx.fb) fx.fb.forEach((t) => deleteTarget(gl, t));
    if (fx.prevInput) deleteTarget(gl, fx.prevInput);
    if (fx.sim) fx.sim.forEach((t) => deleteTarget(gl, t));
    if (fx.particles) fx.particles.forEach((t) => deleteTarget(gl, t));
  }

  // -- public API ------------------------------------------------------------

  // Replace the active chain. Effects already in the chain keep their state
  // (feedback trails, history) so toggling other effects doesn't reset them.
  setEffects(list) {
    const next = (list || []).filter((e) => e && e.def);
    const ids = new Set(next.map((e) => e.def.id));
    for (const [id, fx] of this.fxState) {
      if (!ids.has(id)) {
        this.disposeFx(fx);
        this.fxState.delete(id);
      }
    }
    this.effects = next.map((e) => ({ def: e.def, values: e.values || {} }));
  }

  // Update one chained effect's param values without resetting its state.
  setValues(id, values) {
    const entry = this.effects.find((e) => e.def.id === id);
    if (entry) entry.values = values || {};
  }

  // Single-effect compatibility sugar.
  setEffect(def, values) {
    this.setEffects(def ? [{ def, values }] : []);
  }

  setParams(values) {
    if (this.effects.length === 1) this.effects[0].values = values || {};
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const gl = this.gl;
    for (const rec of this.programs.values()) {
      for (const r of [rec.main, rec.sim, rec.update, rec.draw]) {
        if (r) gl.deleteProgram(r.prog);
      }
    }
    gl.deleteProgram(this.passProg.prog);
    this.videoTex.forEach((t) => gl.deleteTexture(t));
    this.fxState.forEach((fx) => this.disposeFx(fx));
    this.fxState.clear();
    if (this.chainTargets) this.chainTargets.forEach((t) => deleteTarget(gl, t));
    gl.deleteBuffer(this.quad.buf);
    gl.deleteVertexArray(this.quad.vao);
    gl.deleteVertexArray(this.emptyVao);
  }

  // -- sizing / uploads --------------------------------------------------------

  setSize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    if (this.chainTargets) {
      this.chainTargets.forEach((t) => deleteTarget(gl, t));
      this.chainTargets = null;
    }
    // Canvas-size per-effect buffers must be rebuilt; their content is lost.
    for (const fx of this.fxState.values()) {
      if (fx.fb) {
        fx.fb.forEach((t) => deleteTarget(gl, t));
        fx.fb = null;
      }
      if (fx.prevInput) {
        deleteTarget(gl, fx.prevInput);
        fx.prevInput = null;
      }
      fx.resetNeeded = true;
    }
  }

  resizeIfNeeded() {
    const scale = Math.min(1, this.maxSide / Math.max(this.srcW, this.srcH));
    this.setSize(
      Math.max(2, Math.round(this.srcW * scale)),
      Math.max(2, Math.round(this.srcH * scale))
    );
  }

  uploadSource(tex, source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  // -- drive modes ---------------------------------------------------------------

  // Live-preview loop: follow the <video> element's clock.
  frame() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    this.srcW = v.videoWidth;
    this.srcH = v.videoHeight;
    this.resizeIfNeeded();

    let newFrame = false;
    if (v.currentTime !== this.lastVideoTime || !this.hasFrame) {
      this.parity ^= 1;
      this.uploadSource(this.videoTex[this.parity], v);
      if (!this.hasFrame) this.uploadSource(this.videoTex[this.parity ^ 1], v);
      this.lastVideoTime = v.currentTime;
      this.hasFrame = true;
      newFrame = true;
    }

    this.renderFrame((performance.now() - this.t0) / 1000, newFrame);
  }

  // Manual/offline mode: set the output size once...
  setExportSize(w, h) {
    this.setSize(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)));
  }

  // ...then push source frames one by one, with explicit timestamps, so
  // time-based effects (history, feedback, sim) advance deterministically.
  pushFrame(source, timeSec) {
    this.srcW = source.displayWidth ?? source.videoWidth ?? source.width ?? this.srcW;
    this.srcH = source.displayHeight ?? source.videoHeight ?? source.height ?? this.srcH;
    if (!this.width) this.resizeIfNeeded();
    this.parity ^= 1;
    this.uploadSource(this.videoTex[this.parity], source);
    if (!this.hasFrame) {
      this.uploadSource(this.videoTex[this.parity ^ 1], source);
      this.hasFrame = true;
    }
    this.renderFrame(timeSec, true);
  }

  // -- chain rendering -------------------------------------------------------------

  renderFrame(time, newFrame) {
    if (!this.hasFrame || !this.width) return;
    const gl = this.gl;
    let input = this.videoTex[this.parity];
    for (const entry of this.effects) {
      input = this.renderEffect(entry, input, time, newFrame);
    }
    this.drawPass(input, null, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  renderEffect(entry, inputTex, time, newFrame) {
    const { def, values } = entry;
    const recs = this.getEffectPrograms(def);
    const fx = this.getFx(def.id);
    switch (def.type) {
      case 'history':
        return this.renderHistory(def, values, recs, fx, inputTex, time, newFrame);
      case 'feedback':
      case 'flow':
        return this.renderFeedback(def, values, recs, fx, inputTex, time, newFrame);
      case 'sim':
        return this.renderSim(def, values, recs, fx, inputTex, time);
      case 'particles':
        return this.renderParticles(def, values, recs, fx, inputTex, time);
      default:
        return this.renderSimple(def, values, recs, inputTex, time);
    }
  }

  // A canvas-size intermediate target that is safe to write while reading
  // `inputTex` (never hands back the texture currently being sampled).
  pickChainTarget(inputTex) {
    const gl = this.gl;
    if (!this.chainTargets) {
      this.chainTargets = [
        createTarget(gl, this.width, this.height),
        createTarget(gl, this.width, this.height),
      ];
      this.chainFlip = 0;
    }
    this.chainFlip ^= 1;
    let t = this.chainTargets[this.chainFlip];
    if (t.texture === inputTex) t = this.chainTargets[this.chainFlip ^= 1];
    return t;
  }

  bindCommon(rec, targetW, targetH, time, inputTex) {
    const gl = this.gl;
    gl.useProgram(rec.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    gl.uniform1i(this.loc(rec, 'u_tex'), 0);
    gl.uniform2f(this.loc(rec, 'u_res'), targetW, targetH);
    gl.uniform2f(this.loc(rec, 'u_texRes'), this.srcW, this.srcH);
    gl.uniform1f(this.loc(rec, 'u_time'), time);
  }

  applyParams(rec, def, values) {
    const gl = this.gl;
    for (const p of def.params) {
      const l = this.loc(rec, 'u_' + p.key);
      if (!l) continue;
      const v = values[p.key] ?? p.def;
      if (p.kind === 'color') {
        const [r, g, b] = hexToRgb(v);
        gl.uniform3f(l, r, g, b);
      } else if (p.kind === 'xy') {
        gl.uniform2f(l, Number(v?.x) || 0, Number(v?.y) || 0);
      } else {
        gl.uniform1f(l, Number(v) || 0);
      }
    }
  }

  drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.quad.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  // Passthrough draw of `tex` into `fbo` (null = canvas) at the given gain.
  drawPass(tex, fbo, gain, viewport) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const [x, y, w, h] = viewport || [0, 0, this.width, this.height];
    gl.viewport(x, y, w, h);
    const rec = this.passProg;
    gl.useProgram(rec.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc(rec, 'u_tex'), 0);
    gl.uniform1f(this.loc(rec, 'u_gain'), gain);
    this.drawQuad();
  }

  clearTarget(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // -- per-type pipelines (each returns its output texture) ----------------------

  renderSimple(def, values, recs, inputTex, time) {
    const gl = this.gl;
    const target = this.pickChainTarget(inputTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.width, this.height);
    this.bindCommon(recs.main, this.width, this.height, time, inputTex);
    this.applyParams(recs.main, def, values);
    this.drawQuad();
    return target.texture;
  }

  renderHistory(def, values, recs, fx, inputTex, time, newFrame) {
    const gl = this.gl;
    if (!fx.atlas) fx.atlas = createTarget(gl, HATLAS, HATLAS);
    if (newFrame || fx.histLen === 0) {
      fx.histHead = (fx.histHead + 1) % HFRAMES;
      fx.histLen = Math.min(fx.histLen + 1, HFRAMES);
      const cx = (fx.histHead % HGRID) * HCELL;
      const cy = Math.floor(fx.histHead / HGRID) * HCELL;
      this.drawPass(inputTex, fx.atlas.fbo, 1, [cx, cy, HCELL, HCELL]);
    }
    const target = this.pickChainTarget(inputTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.width, this.height);
    const rec = recs.main;
    this.bindCommon(rec, this.width, this.height, time, inputTex);
    this.applyParams(rec, def, values);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fx.atlas.texture);
    gl.uniform1i(this.loc(rec, 'u_hist'), 1);
    gl.uniform1f(this.loc(rec, 'u_histHead'), fx.histHead);
    gl.uniform1f(this.loc(rec, 'u_histLen'), fx.histLen);
    this.drawQuad();
    return target.texture;
  }

  renderFeedback(def, values, recs, fx, inputTex, time, newFrame) {
    const gl = this.gl;
    if (!fx.fb) {
      fx.fb = [
        createTarget(gl, this.width, this.height),
        createTarget(gl, this.width, this.height),
      ];
      fx.resetNeeded = true;
    }
    const isFlow = def.type === 'flow';
    if (isFlow && !fx.prevInput) {
      fx.prevInput = createTarget(gl, this.width, this.height);
      this.drawPass(inputTex, fx.prevInput.fbo, 1); // first frame: no motion
    }
    if (fx.resetNeeded) {
      fx.fb.forEach((t) => this.clearTarget(t));
      if (fx.prevInput) this.drawPass(inputTex, fx.prevInput.fbo, 1);
      fx.resetNeeded = false;
    }
    const [read, write] = fx.fb;
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, this.width, this.height);
    const rec = recs.main;
    this.bindCommon(rec, this.width, this.height, time, inputTex);
    this.applyParams(rec, def, values);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(this.loc(rec, 'u_prev'), 1);
    if (isFlow) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, fx.prevInput.texture);
      gl.uniform1i(this.loc(rec, 'u_prevTex'), 2);
    }
    this.drawQuad();
    if (isFlow && newFrame) this.drawPass(inputTex, fx.prevInput.fbo, 1);
    fx.fb = [write, read];
    return write.texture;
  }

  renderSim(def, values, recs, fx, inputTex, time) {
    const gl = this.gl;
    if (!fx.sim) {
      // Float textures are only LINEAR-filterable with OES_texture_float_linear;
      // fall back to NEAREST (the sim itself samples at texel centers anyway,
      // LINEAR just smooths the upscale in the display pass).
      const opts = {
        ...this.floatTargetOpts(),
        filter: this.floatLinearOk ? gl.LINEAR : gl.NEAREST,
      };
      fx.sim = [
        createTarget(gl, SIM_RES, SIM_RES, opts),
        createTarget(gl, SIM_RES, SIM_RES, opts),
      ];
      fx.resetNeeded = true;
    }
    const simRec = recs.sim;
    const step = (reset) => {
      const [read, write] = fx.sim;
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      this.bindCommon(simRec, SIM_RES, SIM_RES, time, inputTex);
      this.applyParams(simRec, def, values);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, read.texture);
      gl.uniform1i(this.loc(simRec, 'u_sim'), 1);
      gl.uniform2f(this.loc(simRec, 'u_simRes'), SIM_RES, SIM_RES);
      gl.uniform1f(this.loc(simRec, 'u_reset'), reset ? 1 : 0);
      this.drawQuad();
      fx.sim = [write, read];
    };
    if (fx.resetNeeded) {
      step(true);
      fx.resetNeeded = false;
    }
    for (let i = 0; i < 10; i++) step(false);
    const target = this.pickChainTarget(inputTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.width, this.height);
    const rec = recs.main;
    this.bindCommon(rec, this.width, this.height, time, inputTex);
    this.applyParams(rec, def, values);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fx.sim[0].texture);
    gl.uniform1i(this.loc(rec, 'u_sim'), 1);
    this.drawQuad();
    return target.texture;
  }

  renderParticles(def, values, recs, fx, inputTex, time) {
    const gl = this.gl;
    if (!this.halfOk) {
      // No float render targets: particle state can't be stored — pass through.
      return inputTex;
    }
    if (!fx.particles) {
      const opts = { ...this.floatTargetOpts(), filter: gl.NEAREST };
      fx.particles = [
        createTarget(gl, PARTICLE_DIM, PARTICLE_DIM, opts),
        createTarget(gl, PARTICLE_DIM, PARTICLE_DIM, opts),
      ];
      fx.resetNeeded = true;
    }
    const step = (reset) => {
      const [read, write] = fx.particles;
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, PARTICLE_DIM, PARTICLE_DIM);
      const rec = recs.update;
      this.bindCommon(rec, PARTICLE_DIM, PARTICLE_DIM, time, inputTex);
      this.applyParams(rec, def, values);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, read.texture);
      gl.uniform1i(this.loc(rec, 'u_state'), 1);
      gl.uniform1f(this.loc(rec, 'u_reset'), reset ? 1 : 0);
      this.drawQuad();
      fx.particles = [write, read];
    };
    if (fx.resetNeeded) {
      step(true);
      fx.resetNeeded = false;
    }
    step(false);

    // Dim underlay of the input, then the particles as soft additive points.
    const target = this.pickChainTarget(inputTex);
    this.drawPass(inputTex, target.fbo, 0.06);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.width, this.height);
    const draw = recs.draw;
    gl.useProgram(draw.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    gl.uniform1i(this.loc(draw, 'u_tex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fx.particles[0].texture);
    gl.uniform1i(this.loc(draw, 'u_state'), 1);
    gl.uniform1f(this.loc(draw, 'u_stateDim'), PARTICLE_DIM);
    gl.uniform1f(this.loc(draw, 'u_pointSize'), Number(values.size) || 3);
    const count = Math.min(
      Math.max(Math.round(Number(values.count) || 1000), 1),
      PARTICLE_DIM * PARTICLE_DIM
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return target.texture;
  }
}
