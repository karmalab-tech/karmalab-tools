// WebGL2 render engine for the Video Effects tool.
//
// One engine instance owns the effect <canvas> and reads frames from the
// shared <video> element (the same element shown on the left, so the two sides
// are always in sync). Each animation frame it uploads the current video frame
// as a texture and runs the selected effect's pipeline:
//
//   simple     one fragment shader, video in → canvas out
//   history    also keeps a ring of past frames in a grid atlas texture
//              (hist(uv, framesBack) in the shader samples it)
//   feedback   the previous *output* frame is fed back in as u_prev
//   flow       feedback + the previous *video* frame as u_prevTex
//   sim        a ping-pong simulation buffer (reaction-diffusion) stepped
//              several times per frame, then a display shader
//   particles  particle state (pos/vel) lives in a float ping-pong texture,
//              updated in a shader and drawn as point sprites
//
// Effects declare per-param uniforms (u_<key>) that are set from the UI values
// on every draw, so slider tweaks are visible immediately, even while paused.

import {
  createProgram,
  createTexture,
  createTarget,
  deleteTarget,
  createFullscreenQuad,
  hexToRgb,
} from './gl.js';

const MAX_SIDE = 1280; // cap the effect canvas resolution for performance

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
  // Two modes:
  //  - live preview: pass the <video> element; a rAF loop follows its clock.
  //  - manual/offline (video = null): no loop — the caller drives it with
  //    setExportSize() + pushFrame(source, timeSec), one deterministic frame
  //    at a time (used by the export pipeline; `source` is any TexImageSource,
  //    typically a WebCodecs VideoFrame). opts.maxSide caps the canvas
  //    resolution (Infinity for full-res export).
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
    this.programs = new Map(); // effect id -> { prog, locs } (+ sim/update)
    this.passProg = this.buildProgram(VERT, PASS_FRAG);

    // Two video textures, uploaded alternately, so the previous frame is
    // always available (used by the optical-flow effect).
    this.videoTex = [this.makeVideoTexture(), this.makeVideoTexture()];
    this.parity = 0;
    this.hasFrame = false;
    this.lastVideoTime = -1;

    this.effect = null;
    this.values = {};
    this.resetNeeded = true;

    // Lazily allocated per-pipeline resources.
    this.atlas = null;
    this.histHead = 0;
    this.histLen = 0;
    this.fb = null; // feedback ping-pong [read, write]
    this.sim = null;
    this.particles = null;

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

  // -- public API ------------------------------------------------------------

  setEffect(def, values) {
    this.effect = def;
    this.values = values || {};
    this.resetNeeded = true;
    this.histLen = 0;
  }

  setParams(values) {
    this.values = values || {};
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
    if (this.atlas) deleteTarget(gl, this.atlas);
    if (this.fb) this.fb.forEach((t) => deleteTarget(gl, t));
    if (this.sim) this.sim.forEach((t) => deleteTarget(gl, t));
    if (this.particles) this.particles.forEach((t) => deleteTarget(gl, t));
    gl.deleteBuffer(this.quad.buf);
    gl.deleteVertexArray(this.quad.vao);
    gl.deleteVertexArray(this.emptyVao);
  }

  // -- per-frame work ---------------------------------------------------------

  setSize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.fb) {
      this.fb.forEach((t) => deleteTarget(this.gl, t));
      this.fb = null;
    }
    this.resetNeeded = true;
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

  bindCommon(rec, targetW, targetH, time) {
    const gl = this.gl;
    gl.useProgram(rec.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex[this.parity]);
    gl.uniform1i(this.loc(rec, 'u_tex'), 0);
    gl.uniform2f(this.loc(rec, 'u_res'), targetW, targetH);
    gl.uniform2f(this.loc(rec, 'u_texRes'), this.srcW, this.srcH);
    gl.uniform1f(this.loc(rec, 'u_time'), time);
  }

  applyParams(rec, def) {
    const gl = this.gl;
    for (const p of def.params) {
      const l = this.loc(rec, 'u_' + p.key);
      if (!l) continue;
      const v = this.values[p.key] ?? p.def;
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

  // One frame through the selected effect's pipeline, onto the canvas.
  renderFrame(time, newFrame) {
    if (!this.hasFrame || !this.width) return;
    const gl = this.gl;
    const def = this.effect;
    if (!def) {
      this.drawPass(this.videoTex[this.parity], null, 1);
      return;
    }

    const recs = this.getEffectPrograms(def);
    switch (def.type) {
      case 'history':
        this.renderHistory(def, recs, time, newFrame);
        break;
      case 'feedback':
      case 'flow':
        this.renderFeedback(def, recs, time);
        break;
      case 'sim':
        this.renderSim(def, recs, time);
        break;
      case 'particles':
        this.renderParticles(def, recs, time);
        break;
      default:
        this.renderSimple(def, recs, time);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // -- pipelines ---------------------------------------------------------------

  renderSimple(def, recs, time) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    this.bindCommon(recs.main, this.width, this.height, time);
    this.applyParams(recs.main, def);
    this.drawQuad();
  }

  renderHistory(def, recs, time, newFrame) {
    const gl = this.gl;
    if (!this.atlas) this.atlas = createTarget(gl, HATLAS, HATLAS);
    if (newFrame || this.histLen === 0) {
      this.histHead = (this.histHead + 1) % HFRAMES;
      this.histLen = Math.min(this.histLen + 1, HFRAMES);
      const cx = (this.histHead % HGRID) * HCELL;
      const cy = Math.floor(this.histHead / HGRID) * HCELL;
      this.drawPass(this.videoTex[this.parity], this.atlas.fbo, 1, [cx, cy, HCELL, HCELL]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const rec = recs.main;
    this.bindCommon(rec, this.width, this.height, time);
    this.applyParams(rec, def);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.uniform1i(this.loc(rec, 'u_hist'), 1);
    gl.uniform1f(this.loc(rec, 'u_histHead'), this.histHead);
    gl.uniform1f(this.loc(rec, 'u_histLen'), this.histLen);
    this.drawQuad();
  }

  renderFeedback(def, recs, time) {
    const gl = this.gl;
    if (!this.fb) {
      this.fb = [
        createTarget(gl, this.width, this.height),
        createTarget(gl, this.width, this.height),
      ];
      this.resetNeeded = true;
    }
    if (this.resetNeeded) {
      this.fb.forEach((t) => this.clearTarget(t));
      this.resetNeeded = false;
    }
    const [read, write] = this.fb;
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, this.width, this.height);
    const rec = recs.main;
    this.bindCommon(rec, this.width, this.height, time);
    this.applyParams(rec, def);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(this.loc(rec, 'u_prev'), 1);
    if (def.type === 'flow') {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.videoTex[this.parity ^ 1]);
      gl.uniform1i(this.loc(rec, 'u_prevTex'), 2);
    }
    this.drawQuad();
    this.drawPass(write.texture, null, 1);
    this.fb = [write, read];
  }

  renderSim(def, recs, time) {
    const gl = this.gl;
    if (!this.sim) {
      // Float textures are only LINEAR-filterable with OES_texture_float_linear;
      // fall back to NEAREST (the sim itself samples at texel centers anyway,
      // LINEAR just smooths the upscale in the display pass).
      const opts = {
        ...this.floatTargetOpts(),
        filter: this.floatLinearOk ? gl.LINEAR : gl.NEAREST,
      };
      this.sim = [
        createTarget(gl, SIM_RES, SIM_RES, opts),
        createTarget(gl, SIM_RES, SIM_RES, opts),
      ];
      this.resetNeeded = true;
    }
    const simRec = recs.sim;
    const step = (reset) => {
      const [read, write] = this.sim;
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, SIM_RES, SIM_RES);
      this.bindCommon(simRec, SIM_RES, SIM_RES, time);
      this.applyParams(simRec, def);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, read.texture);
      gl.uniform1i(this.loc(simRec, 'u_sim'), 1);
      gl.uniform2f(this.loc(simRec, 'u_simRes'), SIM_RES, SIM_RES);
      gl.uniform1f(this.loc(simRec, 'u_reset'), reset ? 1 : 0);
      this.drawQuad();
      this.sim = [write, read];
    };
    if (this.resetNeeded) {
      step(true);
      this.resetNeeded = false;
    }
    for (let i = 0; i < 10; i++) step(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const rec = recs.main;
    this.bindCommon(rec, this.width, this.height, time);
    this.applyParams(rec, def);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sim[0].texture);
    gl.uniform1i(this.loc(rec, 'u_sim'), 1);
    this.drawQuad();
  }

  renderParticles(def, recs, time) {
    const gl = this.gl;
    if (!this.halfOk) {
      // No float render targets: particle state can't be stored — show the video.
      this.drawPass(this.videoTex[this.parity], null, 1);
      return;
    }
    if (!this.particles) {
      const opts = { ...this.floatTargetOpts(), filter: gl.NEAREST };
      this.particles = [
        createTarget(gl, PARTICLE_DIM, PARTICLE_DIM, opts),
        createTarget(gl, PARTICLE_DIM, PARTICLE_DIM, opts),
      ];
      this.resetNeeded = true;
    }
    const step = (reset) => {
      const [read, write] = this.particles;
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, PARTICLE_DIM, PARTICLE_DIM);
      const rec = recs.update;
      this.bindCommon(rec, PARTICLE_DIM, PARTICLE_DIM, time);
      this.applyParams(rec, def);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, read.texture);
      gl.uniform1i(this.loc(rec, 'u_state'), 1);
      gl.uniform1f(this.loc(rec, 'u_reset'), reset ? 1 : 0);
      this.drawQuad();
      this.particles = [write, read];
    };
    if (this.resetNeeded) {
      step(true);
      this.resetNeeded = false;
    }
    step(false);

    // Dim video underlay, then the particles as soft additive points.
    this.drawPass(this.videoTex[this.parity], null, 0.06);
    const draw = recs.draw;
    gl.useProgram(draw.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex[this.parity]);
    gl.uniform1i(this.loc(draw, 'u_tex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.particles[0].texture);
    gl.uniform1i(this.loc(draw, 'u_state'), 1);
    gl.uniform1f(this.loc(draw, 'u_stateDim'), PARTICLE_DIM);
    gl.uniform1f(this.loc(draw, 'u_pointSize'), Number(this.values.size) || 3);
    const count = Math.min(
      Math.max(Math.round(Number(this.values.count) || 1000), 1),
      PARTICLE_DIM * PARTICLE_DIM
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
