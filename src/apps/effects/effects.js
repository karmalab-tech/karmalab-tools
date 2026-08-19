// The Video Effects catalogue: for each effect, UI metadata (name, one-line
// blurb, parameters with their own help sentences) plus the GLSL ES 3.00
// fragment shader that implements it. The engine (engine.js) prepends a shared
// header (u_tex, u_res, u_time, v_uv, luma/hash helpers) and, for history
// effects, a `hist(uv, framesBack)` sampler over the frame-ring atlas.
//
// Param kinds:
//   range  → slider + number input, maps to `uniform float u_<key>`
//   select → dropdown, option value maps to `uniform float u_<key>`
//   color  → color picker, maps to `uniform vec3 u_<key>`
//   xy     → two sliders (X/Y), maps to `uniform vec2 u_<key>`
//
// Effect types the engine understands:
//   simple (default) · history (past-frames atlas) · feedback (previous output)
//   flow (previous output + previous video frame) · sim (ping-pong simulation)
//   particles (GPU particle state texture)

// ---------------------------------------------------------------------------

export const EFFECTS = [
  {
    id: 'dither',
    name: 'Dither',
    blurb: 'Reduces the image to a handful of tones and fakes the missing shades with patterned dots.',
    params: [
      {
        key: 'algorithm', label: 'Algorithm', kind: 'select', def: 0,
        options: [
          { value: 0, label: 'Bayer' },
          { value: 1, label: 'Atkinson' },
          { value: 2, label: 'Floyd–Steinberg' },
        ],
        help: 'The dot pattern used to simulate in-between shades.',
      },
      { key: 'scale', label: 'Scale', kind: 'range', min: 1, max: 12, step: 1, def: 2, help: 'Size of the dither pixels — bigger looks chunkier and more retro.' },
      { key: 'threshold', label: 'Threshold', kind: 'range', min: -0.5, max: 0.5, step: 0.01, def: 0, help: 'Shifts the balance between dark and light dots.' },
      { key: 'colors', label: 'Colors', kind: 'range', min: 2, max: 16, step: 1, def: 2, help: 'Number of tones kept per color channel.' },
    ],
    frag: /* glsl */ `
uniform float u_algorithm, u_scale, u_threshold, u_colors;
float bayer4(vec2 p){
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return (float(m[y*4+x]) + 0.5) / 16.0;
}
void main(){
  vec2 px = floor(gl_FragCoord.xy / u_scale);
  vec2 uv = (px * u_scale + u_scale * 0.5) / u_res;
  vec3 c = texture(u_tex, uv).rgb;
  float d;
  if (u_algorithm < 0.5) {
    d = bayer4(px);
  } else if (u_algorithm < 1.5) {
    // Atkinson look: a softened ordered matrix with a light random component.
    d = 0.5 + (bayer4(px) - 0.5) * 0.6 + (hash12(px) - 0.5) * 0.2;
  } else {
    // Floyd–Steinberg look: per-pixel noise reads like diffused error.
    d = hash12(px);
  }
  float n = max(u_colors - 1.0, 1.0);
  vec3 q = floor(c * n + d + u_threshold) / n;
  outColor = vec4(clamp(q, 0.0, 1.0), 1.0);
}`,
  },

  {
    id: 'bitmap',
    name: 'Bitmap',
    blurb: 'Crushes the video to pure 1-bit: every pixel becomes either the foreground or the background color.',
    params: [
      { key: 'threshold', label: 'Threshold', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5, help: 'Brightness cut-off between background and foreground.' },
      { key: 'pixelSize', label: 'Pixel size', kind: 'range', min: 1, max: 24, step: 1, def: 4, help: 'Size of the bitmap blocks — bigger means blockier.' },
      { key: 'fg', label: 'Foreground color', kind: 'color', def: '#ffffff', help: 'Color used where the video is brighter than the threshold.' },
      { key: 'bg', label: 'Background color', kind: 'color', def: '#000000', help: 'Color used where the video is darker than the threshold.' },
    ],
    frag: /* glsl */ `
uniform float u_threshold, u_pixelSize;
uniform vec3 u_fg, u_bg;
void main(){
  vec2 px = floor(gl_FragCoord.xy / u_pixelSize);
  vec2 uv = (px * u_pixelSize + u_pixelSize * 0.5) / u_res;
  float l = luma(texture(u_tex, uv).rgb);
  outColor = vec4(l > u_threshold ? u_fg : u_bg, 1.0);
}`,
  },

  {
    id: 'halftone',
    name: 'Halftone',
    blurb: 'Rebuilds the image out of ink dots on paper, like a printed newspaper photo.',
    params: [
      { key: 'dotSize', label: 'Dot size', kind: 'range', min: 0.2, max: 2, step: 0.05, def: 1, help: 'Maximum size of the ink dots relative to the grid.' },
      { key: 'spacing', label: 'Spacing', kind: 'range', min: 3, max: 32, step: 1, def: 9, help: 'Distance between dot centers, in pixels.' },
      { key: 'angle', label: 'Angle', kind: 'range', min: 0, max: 180, step: 1, def: 45, help: 'Rotation of the dot grid, in degrees.' },
      { key: 'contrast', label: 'Contrast', kind: 'range', min: 0.2, max: 3, step: 0.05, def: 1, help: 'Pushes tones apart before they become dots.' },
    ],
    frag: /* glsl */ `
uniform float u_dotSize, u_spacing, u_angle, u_contrast;
void main(){
  float a = radians(u_angle);
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = R * gl_FragCoord.xy;
  vec2 center = (floor(p / u_spacing) + 0.5) * u_spacing;
  vec2 uv = clamp((transpose(R) * center) / u_res, 0.0, 1.0);
  float l = luma(texture(u_tex, uv).rgb);
  l = clamp((l - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float radius = (1.0 - l) * u_dotSize * u_spacing * 0.7;
  float d = length(p - center);
  float ink = smoothstep(radius, radius - 1.5, d);
  outColor = vec4(vec3(1.0 - ink), 1.0);
}`,
  },

  {
    id: 'pixel-sort',
    name: 'Pixel Sort',
    blurb: 'Smears runs of bright pixels along one direction, like a glitched sorting algorithm.',
    params: [
      {
        key: 'direction', label: 'Direction', kind: 'select', def: 0,
        options: [
          { value: 0, label: 'Right' },
          { value: 1, label: 'Left' },
          { value: 2, label: 'Down' },
          { value: 3, label: 'Up' },
        ],
        help: 'Which way the sorted streaks travel.',
      },
      { key: 'threshold', label: 'Threshold', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.45, help: 'Brightness above which pixels join a sorted run.' },
      { key: 'length', label: 'Length', kind: 'range', min: 4, max: 64, step: 1, def: 32, help: 'Maximum length of a streak, in pixels.' },
      { key: 'intensity', label: 'Intensity', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.8, help: 'How strongly runs get stretched into streaks.' },
    ],
    frag: /* glsl */ `
uniform float u_direction, u_threshold, u_length, u_intensity;
void main(){
  vec2 dir = u_direction < 0.5 ? vec2(1.0, 0.0)
           : u_direction < 1.5 ? vec2(-1.0, 0.0)
           : u_direction < 2.5 ? vec2(0.0, -1.0)
           : vec2(0.0, 1.0);
  vec2 d = dir / u_res;
  vec3 c = texture(u_tex, v_uv).rgb;
  if (luma(c) < u_threshold) { outColor = vec4(c, 1.0); return; }
  // Walk back along the direction to find where this bright run starts.
  float back = 0.0;
  for (int i = 1; i < 64; i++) {
    if (float(i) > u_length) break;
    vec2 uv = v_uv - d * float(i);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    if (luma(texture(u_tex, uv).rgb) < u_threshold) break;
    back = float(i);
  }
  // Stretch the run: sample closer to its start the stronger the intensity.
  vec3 s = texture(u_tex, v_uv - d * back * u_intensity).rgb;
  outColor = vec4(mix(c, s, u_intensity), 1.0);
}`,
  },

  {
    id: 'tessellation',
    name: 'Tessellation',
    blurb: 'Rebuilds the image out of flat geometric tiles, each filled with one sampled color.',
    params: [
      { key: 'tileSize', label: 'Tile size', kind: 'range', min: 6, max: 80, step: 1, def: 24, help: 'Size of each tile, in pixels.' },
      {
        key: 'shape', label: 'Shape', kind: 'select', def: 0,
        options: [
          { value: 0, label: 'Square' },
          { value: 1, label: 'Triangle' },
          { value: 2, label: 'Hexagon' },
        ],
        help: 'The tile shape the grid is built from.',
      },
      { key: 'rotation', label: 'Rotation', kind: 'range', min: 0, max: 90, step: 1, def: 0, help: 'Rotates the whole tile grid, in degrees.' },
      { key: 'distortion', label: 'Distortion', kind: 'range', min: 0, max: 1, step: 0.01, def: 0, help: 'Randomly nudges each tile’s sampling point for a hand-made look.' },
    ],
    frag: /* glsl */ `
uniform float u_tileSize, u_shape, u_rotation, u_distortion;
vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * p; }
void main(){
  float a = radians(u_rotation);
  vec2 half_ = u_res * 0.5;
  vec2 p = rot2(gl_FragCoord.xy - half_, a);
  vec2 site;
  float edge = 0.0; // 0 center → 1 border, used for subtle grout lines
  if (u_shape < 0.5) {
    vec2 cell = floor(p / u_tileSize);
    site = (cell + 0.5) * u_tileSize;
    vec2 l = abs(p - site) / u_tileSize;
    edge = max(l.x, l.y) * 2.0;
  } else if (u_shape < 1.5) {
    vec2 q = p / u_tileSize;
    vec2 cell = floor(q);
    vec2 f = fract(q);
    bool upper = f.x + f.y > 1.0;
    site = (cell + (upper ? vec2(2.0 / 3.0) : vec2(1.0 / 3.0))) * u_tileSize;
    float dEdge = abs(f.x + f.y - 1.0);
    edge = 1.0 - min(min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)), dEdge) * 3.0;
  } else {
    vec2 s = vec2(1.0, 1.7320508);
    vec2 q = p / u_tileSize;
    vec4 hC = floor(vec4(q, q - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
    vec4 h = vec4(q - hC.xy * s, q - (hC.zw + 0.5) * s);
    vec2 gv = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
    site = (q - gv) * u_tileSize;
    // Hex distance for the border.
    gv = abs(gv);
    edge = max(dot(gv, normalize(s)), gv.x) * 2.0;
  }
  site += (hash22(floor(site / u_tileSize) + 7.31) - 0.5) * u_distortion * u_tileSize;
  vec2 uv = clamp((rot2(site, -a) + half_) / u_res, 0.0, 1.0);
  vec3 c = texture(u_tex, uv).rgb;
  c *= 1.0 - smoothstep(0.88, 1.0, edge) * 0.4;
  outColor = vec4(c, 1.0);
}`,
  },

  {
    id: 'voronoi',
    name: 'Voronoi',
    blurb: 'Shatters the image into organic cells, like stained glass grown from random seed points.',
    params: [
      { key: 'cellSize', label: 'Cell size', kind: 'range', min: 6, max: 80, step: 1, def: 26, help: 'Average size of the cells, in pixels.' },
      { key: 'randomness', label: 'Randomness', kind: 'range', min: 0, max: 1, step: 0.01, def: 1, help: 'How far seed points wander from a regular grid.' },
      { key: 'edgeWidth', label: 'Edge width', kind: 'range', min: 0, max: 0.3, step: 0.005, def: 0.06, help: 'Thickness of the dark line between cells.' },
      {
        key: 'sampling', label: 'Sampling mode', kind: 'select', def: 0,
        options: [
          { value: 0, label: 'Cell center' },
          { value: 1, label: 'Soft blend' },
          { value: 2, label: 'Original + edges' },
        ],
        help: 'How each cell picks its color from the video.',
      },
    ],
    frag: /* glsl */ `
uniform float u_cellSize, u_randomness, u_edgeWidth, u_sampling;
void main(){
  vec2 g = gl_FragCoord.xy / u_cellSize;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float f1 = 8.0, f2 = 8.0;
  vec2 best = vec2(0.0);
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 site = o + 0.5 + (hash22(cell + o) - 0.5) * u_randomness;
    float d = length(site - f);
    if (d < f1) { f2 = f1; f1 = d; best = cell + site; }
    else if (d < f2) { f2 = d; }
  }
  vec2 siteUv = clamp(best * u_cellSize / u_res, 0.0, 1.0);
  vec3 c;
  if (u_sampling < 0.5) {
    c = texture(u_tex, siteUv).rgb;
  } else if (u_sampling < 1.5) {
    vec2 o = vec2(u_cellSize * 0.25) / u_res;
    c = (texture(u_tex, siteUv).rgb
       + texture(u_tex, clamp(siteUv + o, 0.0, 1.0)).rgb
       + texture(u_tex, clamp(siteUv - o, 0.0, 1.0)).rgb) / 3.0;
    c = mix(c, texture(u_tex, v_uv).rgb, 0.35);
  } else {
    c = texture(u_tex, v_uv).rgb;
  }
  float edge = smoothstep(u_edgeWidth + 0.02, u_edgeWidth - 0.02, f2 - f1);
  c *= 1.0 - edge * 0.85;
  outColor = vec4(c, 1.0);
}`,
  },

  {
    id: 'ascii',
    name: 'ASCII',
    blurb: 'Redraws the video as a grid of text characters picked by brightness, terminal-style.',
    params: [
      { key: 'cellSize', label: 'Character size', kind: 'range', min: 6, max: 32, step: 1, def: 12, help: 'Size of each character cell, in pixels.' },
      {
        key: 'charset', label: 'Character set', kind: 'select', def: 0,
        options: [
          { value: 0, label: 'Standard' },
          { value: 1, label: 'Blocks' },
          { value: 2, label: 'Minimal' },
          { value: 3, label: 'Binary' },
        ],
        help: 'Which set of glyphs the brightness ramp maps to.',
      },
      { key: 'contrast', label: 'Contrast', kind: 'range', min: 0.2, max: 3, step: 0.05, def: 1, help: 'Pushes tones apart before picking characters.' },
      {
        key: 'colorMode', label: 'Color mode', kind: 'select', def: 0,
        options: [
          { value: 0, label: 'Terminal green' },
          { value: 1, label: 'White' },
          { value: 2, label: 'Original colors' },
        ],
        help: 'How the characters are tinted.',
      },
    ],
    frag: /* glsl */ `
uniform float u_cellSize, u_charset, u_contrast, u_colorMode;
// 5x5 glyph bitmaps packed into ints (bit = row*5 + col, row 0 = top).
const int STD[10] = int[10](0, 131072, 131200, 14336, 459200, 145536, 332096, 11512810, 27070835, 15398446);
const int MINI[4] = int[4](0, 131072, 145536, 18157905);
const int BIN0 = 15259182;
const int BIN1 = 14815428;
float glyphBit(int g, vec2 p){
  ivec2 ip = ivec2(clamp(p, 0.0, 0.999) * 5.0);
  return float((g >> (ip.y * 5 + ip.x)) & 1);
}
void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_cellSize);
  vec2 uv = clamp((cell * u_cellSize + u_cellSize * 0.5) / u_res, 0.0, 1.0);
  vec3 c = texture(u_tex, uv).rgb;
  float l = clamp((luma(c) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  vec2 p = fract(gl_FragCoord.xy / u_cellSize);
  p.y = 1.0 - p.y; // glyph rows read top-down
  p = (p - 0.5) * 1.35 + 0.5; // small margin around each glyph
  float g;
  bool inside = p.x >= 0.0 && p.x < 1.0 && p.y >= 0.0 && p.y < 1.0;
  if (u_charset < 0.5) {
    g = inside ? glyphBit(STD[int(l * 9.999)], p) : 0.0;
  } else if (u_charset < 1.5) {
    g = max(abs(p.x - 0.5), abs(p.y - 0.5)) < l * 0.5 ? 1.0 : 0.0;
  } else if (u_charset < 2.5) {
    g = inside ? glyphBit(MINI[int(l * 3.999)], p) : 0.0;
  } else {
    g = (l < 0.12 || !inside) ? 0.0 : glyphBit(l < 0.5 ? BIN0 : BIN1, p);
  }
  vec3 col = u_colorMode < 0.5 ? vec3(0.35, 1.0, 0.45)
           : u_colorMode < 1.5 ? vec3(1.0)
           : c / max(luma(c), 0.05) * 0.8;
  outColor = vec4(col * g, 1.0);
}`,
  },

  {
    id: 'kaleidoscope',
    name: 'Kaleidoscope',
    blurb: 'Mirrors a wedge of the image around a center point into a symmetric, folding pattern.',
    params: [
      { key: 'segments', label: 'Segments', kind: 'range', min: 2, max: 24, step: 1, def: 6, help: 'Number of mirrored wedges around the center.' },
      { key: 'rotation', label: 'Rotation', kind: 'range', min: 0, max: 360, step: 1, def: 0, help: 'Spins the whole pattern, in degrees.' },
      { key: 'zoom', label: 'Zoom', kind: 'range', min: 0.3, max: 3, step: 0.01, def: 1, help: 'Zooms the sampled wedge in or out.' },
      { key: 'center', label: 'Center', kind: 'xy', min: 0, max: 1, step: 0.01, def: { x: 0.5, y: 0.5 }, help: 'Where the mirrors converge on the image.' },
    ],
    frag: /* glsl */ `
uniform float u_segments, u_rotation, u_zoom;
uniform vec2 u_center;
vec2 mirrorUv(vec2 uv){ return abs(fract(uv * 0.5) * 2.0 - 1.0); }
void main(){
  float aspect = u_res.x / u_res.y;
  vec2 p = v_uv - u_center;
  p.x *= aspect;
  float ang = atan(p.y, p.x) + radians(u_rotation);
  float seg = 6.2831853 / max(u_segments, 2.0);
  ang = mod(ang, seg * 2.0);
  ang = abs(ang - seg);
  float r = length(p) / u_zoom;
  vec2 q = vec2(cos(ang), sin(ang)) * r;
  q.x /= aspect;
  outColor = vec4(texture(u_tex, mirrorUv(q + u_center)).rgb, 1.0);
}`,
  },

  {
    id: 'slit-scan',
    name: 'Slit Scan',
    blurb: 'Builds each slice of the frame from a different moment in time, warping motion into liquid ribbons.',
    type: 'history',
    params: [
      {
        key: 'sdir', label: 'Direction', kind: 'select', def: 0,
        options: [
          { value: 0, label: 'Horizontal slices' },
          { value: 1, label: 'Vertical slices' },
        ],
        help: 'Whether the time offset sweeps down the frame or across it.',
      },
      { key: 'timeSpan', label: 'Time span', kind: 'range', min: 2, max: 24, step: 1, def: 14, help: 'How many frames back the oldest slice reaches.' },
      { key: 'sliceWidth', label: 'Slice width', kind: 'range', min: 1, max: 40, step: 1, def: 4, help: 'Thickness of each time slice, in pixels.' },
      { key: 'speed', label: 'Speed', kind: 'range', min: 0, max: 4, step: 0.05, def: 1, help: 'How fast the time offset pattern scrolls.' },
    ],
    frag: /* glsl */ `
uniform float u_sdir, u_timeSpan, u_sliceWidth, u_speed;
void main(){
  float axisRes = u_sdir < 0.5 ? u_res.y : u_res.x;
  float coord = u_sdir < 0.5 ? v_uv.y : v_uv.x;
  coord = floor(coord * axisRes / u_sliceWidth) * u_sliceWidth / axisRes;
  float back = fract(coord + u_time * u_speed * 0.15) * u_timeSpan;
  outColor = vec4(hist(v_uv, back).rgb, 1.0);
}`,
  },

  {
    id: 'rgb-delay',
    name: 'RGB Delay',
    blurb: 'Plays the red, green and blue channels at different points in time, so motion splits into colored ghosts.',
    type: 'history',
    params: [
      { key: 'redDelay', label: 'Red delay', kind: 'range', min: 0, max: 24, step: 1, def: 0, help: 'How many frames the red channel lags behind.' },
      { key: 'greenDelay', label: 'Green delay', kind: 'range', min: 0, max: 24, step: 1, def: 6, help: 'How many frames the green channel lags behind.' },
      { key: 'blueDelay', label: 'Blue delay', kind: 'range', min: 0, max: 24, step: 1, def: 12, help: 'How many frames the blue channel lags behind.' },
      { key: 'spatialOffset', label: 'Spatial offset', kind: 'range', min: -40, max: 40, step: 1, def: 0, help: 'Also shifts the channels sideways, in pixels.' },
    ],
    frag: /* glsl */ `
uniform float u_redDelay, u_greenDelay, u_blueDelay, u_spatialOffset;
void main(){
  vec2 off = vec2(u_spatialOffset / u_res.x, 0.0);
  float r = hist(v_uv - off, u_redDelay).r;
  float g = hist(v_uv, u_greenDelay).g;
  float b = hist(v_uv + off, u_blueDelay).b;
  outColor = vec4(r, g, b, 1.0);
}`,
  },

  {
    id: 'frame-echo',
    name: 'Frame Echo',
    blurb: 'Layers fading copies of past frames on top of the present, so movement leaves repeating ghosts.',
    type: 'history',
    params: [
      { key: 'delay', label: 'Delay', kind: 'range', min: 1, max: 8, step: 1, def: 3, help: 'Frames between one echo and the next.' },
      { key: 'echoCount', label: 'Echo count', kind: 'range', min: 1, max: 8, step: 1, def: 4, help: 'How many past copies are layered in.' },
      { key: 'decay', label: 'Decay', kind: 'range', min: 0.2, max: 0.95, step: 0.01, def: 0.65, help: 'How quickly older echoes fade out.' },
      {
        key: 'blendMode', label: 'Blend mode', kind: 'select', def: 0,
        options: [
          { value: 0, label: 'Screen' },
          { value: 1, label: 'Add' },
          { value: 2, label: 'Lighten' },
          { value: 3, label: 'Average' },
        ],
        help: 'How the echoes are mixed with the live frame.',
      },
    ],
    frag: /* glsl */ `
uniform float u_delay, u_echoCount, u_decay, u_blendMode;
void main(){
  vec3 acc = texture(u_tex, v_uv).rgb;
  float w = 1.0;
  for (int i = 1; i <= 8; i++) {
    if (float(i) > u_echoCount) break;
    w *= u_decay;
    vec3 e = hist(v_uv, float(i) * u_delay).rgb;
    if (u_blendMode < 0.5)      acc = 1.0 - (1.0 - acc) * (1.0 - e * w);
    else if (u_blendMode < 1.5) acc += e * w;
    else if (u_blendMode < 2.5) acc = max(acc, e * w);
    else                        acc = mix(acc, e, w * 0.5);
  }
  outColor = vec4(clamp(acc, 0.0, 1.0), 1.0);
}`,
  },

  {
    id: 'feedback',
    name: 'Feedback',
    blurb: 'Feeds the output back into itself like a camera pointed at its own monitor — endless recursive trails.',
    type: 'feedback',
    params: [
      { key: 'persistence', label: 'Persistence', kind: 'range', min: 0.5, max: 0.99, step: 0.005, def: 0.92, help: 'How long the previous frames survive in the loop.' },
      { key: 'zoom', label: 'Zoom', kind: 'range', min: 0.9, max: 1.1, step: 0.001, def: 1.02, help: 'The loop zooms in (>1) or out (<1) every frame.' },
      { key: 'rotFeed', label: 'Rotation', kind: 'range', min: -10, max: 10, step: 0.1, def: 1, help: 'The loop rotates by this many degrees every frame.' },
      { key: 'offset', label: 'Offset', kind: 'xy', min: -0.02, max: 0.02, step: 0.0005, def: { x: 0, y: 0 }, help: 'The loop drifts sideways by this much every frame.' },
    ],
    frag: /* glsl */ `
uniform sampler2D u_prev;
uniform float u_persistence, u_zoom, u_rotFeed;
uniform vec2 u_offset;
void main(){
  float a = radians(u_rotFeed);
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = (v_uv - 0.5);
  p = R * p / u_zoom;
  vec2 puv = p + 0.5 + u_offset;
  vec3 prev = texture(u_prev, clamp(puv, 0.0, 1.0)).rgb;
  vec3 cur = texture(u_tex, v_uv).rgb;
  outColor = vec4(max(cur, prev * u_persistence), 1.0);
}`,
  },

  {
    id: 'optical-flow',
    name: 'Optical Flow',
    blurb: 'Estimates where pixels are moving between frames and paints glowing, smearing trails along the motion.',
    type: 'flow',
    params: [
      { key: 'strength', label: 'Strength', kind: 'range', min: 0, max: 3, step: 0.05, def: 1, help: 'How strongly detected motion colors and drags the image.' },
      { key: 'trail', label: 'Trail length', kind: 'range', min: 0, max: 0.98, step: 0.01, def: 0.85, help: 'How long motion trails linger before fading.' },
      { key: 'sensitivity', label: 'Sensitivity', kind: 'range', min: 0.5, max: 8, step: 0.1, def: 3, help: 'How small a movement still registers as flow.' },
      { key: 'distortion', label: 'Distortion', kind: 'range', min: 0, max: 3, step: 0.05, def: 1, help: 'How much the image itself gets pushed along the flow.' },
    ],
    frag: /* glsl */ `
uniform sampler2D u_prev;     // previous output (accumulated trails)
uniform sampler2D u_prevTex;  // previous video frame
uniform float u_strength, u_trail, u_sensitivity, u_distortion;
vec3 hsv2rgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
void main(){
  vec2 texel = 1.0 / u_res;
  // One-point Lucas–Kanade: flow ≈ -It * ∇I / |∇I|².
  float It = luma(texture(u_tex, v_uv).rgb) - luma(texture(u_prevTex, v_uv).rgb);
  vec2 g = vec2(
    luma(texture(u_tex, v_uv + vec2(texel.x, 0.0)).rgb) - luma(texture(u_tex, v_uv - vec2(texel.x, 0.0)).rgb),
    luma(texture(u_tex, v_uv + vec2(0.0, texel.y)).rgb) - luma(texture(u_tex, v_uv - vec2(0.0, texel.y)).rgb)
  );
  vec2 flow = clamp(-It * g * u_sensitivity / (dot(g, g) + 0.02), -0.05, 0.05);
  vec3 cur = texture(u_tex, clamp(v_uv + flow * u_distortion, 0.0, 1.0)).rgb;
  float mag = length(flow) * u_strength * 60.0;
  float hue = atan(flow.y, flow.x) / 6.2831853 + 0.5;
  vec3 flowCol = hsv2rgb(vec3(hue, 0.85, 1.0));
  vec3 lit = mix(cur, flowCol, clamp(mag, 0.0, 0.85));
  vec3 prev = texture(u_prev, clamp(v_uv - flow * u_strength * 0.3, 0.0, 1.0)).rgb;
  outColor = vec4(max(lit, prev * u_trail), 1.0);
}`,
  },

  {
    id: 'vhs',
    name: 'VHS',
    blurb: 'Degrades the video like a worn tape: grain, wobbly lines, tracking glitches and smeared colors.',
    params: [
      { key: 'noise', label: 'Noise', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.3, help: 'Amount of analog grain over the picture.' },
      { key: 'tracking', label: 'Tracking', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.4, help: 'Strength of the rolling tracking-error band.' },
      { key: 'wobble', label: 'Horizontal wobble', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.3, help: 'How much scanlines sway left and right.' },
      { key: 'bleed', label: 'Color bleed', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5, help: 'How far colors smear past their edges.' },
    ],
    frag: /* glsl */ `
uniform float u_noise, u_tracking, u_wobble, u_bleed;
void main(){
  vec2 uv = v_uv;
  float t = u_time;
  uv.x += sin(uv.y * 8.0 + t * 2.2) * 0.004 * u_wobble
        + sin(uv.y * 41.0 + t * 13.0) * 0.0015 * u_wobble;
  // Rolling tracking band with big horizontal tearing inside it.
  float band = fract(uv.y - t * 0.11);
  float tr = smoothstep(0.0, 0.05, band) * smoothstep(0.11, 0.05, band) * u_tracking;
  uv.x += tr * (hash12(vec2(floor(uv.y * u_res.y), floor(t * 60.0))) - 0.5) * 0.25;
  vec3 c = texture(u_tex, clamp(uv, 0.0, 1.0)).rgb;
  // Sharp luma, smeared chroma sampled to the right.
  vec3 cb = (texture(u_tex, clamp(uv + vec2(0.006 * u_bleed, 0.0), 0.0, 1.0)).rgb
           + texture(u_tex, clamp(uv + vec2(0.013 * u_bleed, 0.0), 0.0, 1.0)).rgb) * 0.5;
  vec3 col = vec3(luma(c)) + (cb - vec3(luma(cb))) * 1.15;
  float n = hash12(uv * u_res + fract(t) * 1000.0);
  col += (n - 0.5) * 0.4 * u_noise;
  col = mix(col, vec3(n), tr * 0.6);
  col = mix(vec3(luma(col)), col, 0.85);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
  },

  {
    id: 'crt',
    name: 'CRT',
    blurb: 'Puts the video behind curved glass: scanlines, color fringing and phosphor glow like an old monitor.',
    params: [
      { key: 'scanline', label: 'Scanline size', kind: 'range', min: 1, max: 8, step: 0.5, def: 3, help: 'Height of each scanline, in pixels.' },
      { key: 'curvature', label: 'Curvature', kind: 'range', min: 0, max: 0.6, step: 0.01, def: 0.25, help: 'How much the screen bulges like a glass tube.' },
      { key: 'rgbsep', label: 'RGB separation', kind: 'range', min: 0, max: 4, step: 0.1, def: 1.2, help: 'How far the color channels fringe apart, in pixels.' },
      { key: 'glow', label: 'Glow', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.4, help: 'Soft phosphor bloom around bright areas.' },
    ],
    frag: /* glsl */ `
uniform float u_scanline, u_curvature, u_rgbsep, u_glow;
void main(){
  vec2 p = v_uv * 2.0 - 1.0;
  p *= 1.0 + u_curvature * 0.08;
  p += p * dot(p, p) * u_curvature * 0.18;
  vec2 uv = (p + 1.0) * 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 sep = vec2(u_rgbsep / u_res.x, 0.0);
  vec3 c = vec3(
    texture(u_tex, clamp(uv - sep, 0.0, 1.0)).r,
    texture(u_tex, uv).g,
    texture(u_tex, clamp(uv + sep, 0.0, 1.0)).b
  );
  vec2 gof = 3.0 / u_res;
  vec3 blur = (texture(u_tex, clamp(uv + gof, 0.0, 1.0)).rgb
             + texture(u_tex, clamp(uv - gof, 0.0, 1.0)).rgb
             + texture(u_tex, clamp(uv + vec2(gof.x, -gof.y), 0.0, 1.0)).rgb
             + texture(u_tex, clamp(uv + vec2(-gof.x, gof.y), 0.0, 1.0)).rgb) * 0.25;
  c += blur * blur * u_glow * 0.9;
  float sl = 0.72 + 0.28 * sin(uv.y * u_res.y * 3.14159 / max(u_scanline, 0.5));
  c *= sl;
  float vig = 1.0 - dot(p * 0.55, p * 0.55);
  c *= clamp(vig, 0.0, 1.0);
  outColor = vec4(c, 1.0);
}`,
  },

  {
    id: 'xerox',
    name: 'Xerox',
    blurb: 'Turns the video into a harsh photocopy: crushed blacks, paper white, gritty grain and inked edges.',
    params: [
      { key: 'threshold', label: 'Threshold', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5, help: 'Brightness where paper turns into ink.' },
      { key: 'grain', label: 'Grain', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.35, help: 'Toner noise breaking up the flat areas.' },
      { key: 'edgeStrength', label: 'Edge strength', kind: 'range', min: 0, max: 2, step: 0.05, def: 1, help: 'How strongly outlines get traced in ink.' },
      { key: 'contrast', label: 'Contrast', kind: 'range', min: 0.5, max: 4, step: 0.05, def: 1.8, help: 'How hard tones are pushed toward black or white.' },
    ],
    frag: /* glsl */ `
uniform float u_threshold, u_grain, u_edgeStrength, u_contrast;
float lumaAt(vec2 uv){ return luma(texture(u_tex, clamp(uv, 0.0, 1.0)).rgb); }
void main(){
  float l = lumaAt(v_uv);
  l = clamp((l - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float n = (hash12(gl_FragCoord.xy + fract(u_time) * 37.0) - 0.5) * u_grain * 0.4;
  vec2 e = 1.5 / u_res;
  float gx = lumaAt(v_uv + vec2(e.x, 0.0)) - lumaAt(v_uv - vec2(e.x, 0.0));
  float gy = lumaAt(v_uv + vec2(0.0, e.y)) - lumaAt(v_uv - vec2(0.0, e.y));
  float edge = length(vec2(gx, gy)) * 2.5;
  float ink = 1.0 - smoothstep(u_threshold - 0.12, u_threshold + 0.12, l + n);
  ink = clamp(ink + edge * u_edgeStrength, 0.0, 1.0);
  vec3 paper = vec3(0.96, 0.95, 0.92);
  outColor = vec4(mix(paper, vec3(0.05), ink), 1.0);
}`,
  },

  {
    id: 'gradient-map',
    name: 'Gradient Map',
    blurb: 'Replaces the video’s brightness with colors picked from a gradient, like thermal imaging.',
    params: [
      {
        key: 'gradient', label: 'Gradient', kind: 'select', def: 0,
        options: [
          { value: 0, label: 'Heat' },
          { value: 1, label: 'Ocean' },
          { value: 2, label: 'Neon' },
          { value: 3, label: 'Sunset' },
          { value: 4, label: 'Mono' },
        ],
        help: 'The color ramp dark-to-bright tones map onto.',
      },
      { key: 'levels', label: 'Levels', kind: 'range', min: 2, max: 32, step: 1, def: 32, help: 'Number of color steps — low values posterize into bands.' },
      { key: 'contrast', label: 'Contrast', kind: 'range', min: 0.3, max: 3, step: 0.05, def: 1, help: 'Stretches brightness before it hits the gradient.' },
      { key: 'mixAmt', label: 'Mix', kind: 'range', min: 0, max: 1, step: 0.01, def: 1, help: 'Blend between the original video and the mapped colors.' },
    ],
    frag: /* glsl */ `
uniform float u_gradient, u_levels, u_contrast, u_mixAmt;
vec3 ramp(vec3 a, vec3 b, vec3 c, vec3 d, float t){
  t = clamp(t, 0.0, 1.0) * 3.0;
  if (t < 1.0) return mix(a, b, t);
  if (t < 2.0) return mix(b, c, t - 1.0);
  return mix(c, d, t - 2.0);
}
void main(){
  vec3 src = texture(u_tex, v_uv).rgb;
  float t = clamp((luma(src) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  if (u_levels < 31.5) t = floor(t * u_levels) / max(u_levels - 1.0, 1.0);
  vec3 g;
  if (u_gradient < 0.5)      g = ramp(vec3(0.0), vec3(0.55, 0.0, 0.1), vec3(1.0, 0.5, 0.0), vec3(1.0, 1.0, 0.85), t);
  else if (u_gradient < 1.5) g = ramp(vec3(0.01, 0.02, 0.15), vec3(0.0, 0.25, 0.55), vec3(0.1, 0.7, 0.75), vec3(0.9, 1.0, 1.0), t);
  else if (u_gradient < 2.5) g = ramp(vec3(0.05, 0.0, 0.15), vec3(0.45, 0.0, 0.75), vec3(1.0, 0.15, 0.6), vec3(1.0, 0.9, 0.3), t);
  else if (u_gradient < 3.5) g = ramp(vec3(0.15, 0.05, 0.3), vec3(0.8, 0.2, 0.4), vec3(1.0, 0.55, 0.25), vec3(1.0, 0.9, 0.6), t);
  else                       g = vec3(t);
  outColor = vec4(mix(src, g, u_mixAmt), 1.0);
}`,
  },

  {
    id: 'edge',
    name: 'Edge',
    blurb: 'Keeps only the outlines of the image, drawn as glowing lines on black.',
    params: [
      { key: 'threshold', label: 'Threshold', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.2, help: 'How strong a contour must be to show up.' },
      { key: 'thickness', label: 'Thickness', kind: 'range', min: 0.5, max: 4, step: 0.1, def: 1, help: 'Width of the detected lines, in pixels.' },
      { key: 'glow', label: 'Glow', kind: 'range', min: 0, max: 2, step: 0.05, def: 0.5, help: 'Soft halo around the lines.' },
      { key: 'edgeColor', label: 'Edge color', kind: 'color', def: '#7df9ff', help: 'Color of the outlines.' },
    ],
    frag: /* glsl */ `
uniform float u_threshold, u_thickness, u_glow;
uniform vec3 u_edgeColor;
float sob(vec2 uv, vec2 e){
  float tl = luma(texture(u_tex, clamp(uv + vec2(-e.x,  e.y), 0.0, 1.0)).rgb);
  float tc = luma(texture(u_tex, clamp(uv + vec2( 0.0,  e.y), 0.0, 1.0)).rgb);
  float tr = luma(texture(u_tex, clamp(uv + vec2( e.x,  e.y), 0.0, 1.0)).rgb);
  float ml = luma(texture(u_tex, clamp(uv + vec2(-e.x,  0.0), 0.0, 1.0)).rgb);
  float mr = luma(texture(u_tex, clamp(uv + vec2( e.x,  0.0), 0.0, 1.0)).rgb);
  float bl = luma(texture(u_tex, clamp(uv + vec2(-e.x, -e.y), 0.0, 1.0)).rgb);
  float bc = luma(texture(u_tex, clamp(uv + vec2( 0.0, -e.y), 0.0, 1.0)).rgb);
  float br = luma(texture(u_tex, clamp(uv + vec2( e.x, -e.y), 0.0, 1.0)).rgb);
  float gx = tr + 2.0 * mr + br - tl - 2.0 * ml - bl;
  float gy = tl + 2.0 * tc + tr - bl - 2.0 * bc - br;
  return length(vec2(gx, gy));
}
void main(){
  vec2 e = u_thickness / u_res;
  float m = sob(v_uv, e);
  float line = smoothstep(u_threshold, u_threshold + 0.25, m);
  float wide = sob(v_uv, e * 2.5);
  float halo = smoothstep(u_threshold * 0.5, u_threshold + 0.6, wide) * u_glow * 0.55;
  outColor = vec4(u_edgeColor * clamp(line + halo, 0.0, 1.6), 1.0);
}`,
  },

  {
    id: 'reaction-diffusion',
    name: 'Reaction Diffusion',
    blurb: 'Grows living coral-like patterns (a Gray–Scott simulation) that feed on the video underneath.',
    type: 'sim',
    params: [
      { key: 'scale', label: 'Scale', kind: 'range', min: 0.5, max: 3, step: 0.05, def: 1, help: 'Size of the grown patterns — higher means bigger cells.' },
      { key: 'feed', label: 'Feed rate', kind: 'range', min: 0.01, max: 0.09, step: 0.001, def: 0.037, help: 'How fast the growing chemical is replenished.' },
      { key: 'kill', label: 'Kill rate', kind: 'range', min: 0.045, max: 0.07, step: 0.0005, def: 0.06, help: 'How fast the pattern chemical is removed — shapes the pattern style.' },
      { key: 'influence', label: 'Video influence', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5, help: 'How strongly bright video areas seed and steer the growth.' },
    ],
    // Ping-pong Gray–Scott step, run several times per displayed frame.
    simFrag: /* glsl */ `
uniform sampler2D u_sim;
uniform vec2 u_simRes;
uniform float u_scale, u_feed, u_kill, u_influence, u_reset;
void main(){
  float lum = luma(texture(u_tex, v_uv).rgb);
  if (u_reset > 0.5) {
    // Seed B in small blobs (a coarse hash grid), not single texels that die.
    float b = (hash12(floor(v_uv * 48.0)) < 0.04 || lum > 0.8) ? 0.5 : 0.0;
    outColor = vec4(1.0, b, 0.0, 1.0);
    return;
  }
  // Canonical Gray–Scott: 9-tap laplacian (0.2 adjacent, 0.05 diagonal),
  // dA = 1.0, dB = 0.5, dt = 1.0.
  vec2 e = u_scale / u_simRes;
  vec2 c = texture(u_sim, v_uv).rg;
  vec2 lap = -c
    + 0.2  * (texture(u_sim, v_uv + vec2( e.x, 0.0)).rg
            + texture(u_sim, v_uv + vec2(-e.x, 0.0)).rg
            + texture(u_sim, v_uv + vec2(0.0,  e.y)).rg
            + texture(u_sim, v_uv + vec2(0.0, -e.y)).rg)
    + 0.05 * (texture(u_sim, v_uv + vec2( e.x,  e.y)).rg
            + texture(u_sim, v_uv + vec2(-e.x,  e.y)).rg
            + texture(u_sim, v_uv + vec2( e.x, -e.y)).rg
            + texture(u_sim, v_uv + vec2(-e.x, -e.y)).rg);
  float A = c.x, B = c.y;
  float f = u_feed + (lum - 0.5) * 0.015 * u_influence;
  float r = A * B * B;
  A += lap.x - r + f * (1.0 - A);
  B += lap.y * 0.5 + r - (u_kill + f) * B;
  // Bright video keeps injecting seeds where the pattern has died out.
  B += u_influence * 0.002 * smoothstep(0.8, 0.95, lum) * step(B, 0.1);
  outColor = vec4(clamp(A, 0.0, 1.0), clamp(B, 0.0, 1.0), 0.0, 1.0);
}`,
    frag: /* glsl */ `
uniform sampler2D u_sim;
void main(){
  vec2 s = texture(u_sim, v_uv).rg;
  float pat = smoothstep(0.12, 0.32, s.y);
  vec3 vid = texture(u_tex, v_uv).rgb;
  vec3 col = mix(vid * 0.12, vid * 1.1 + 0.08, pat);
  outColor = vec4(col, 1.0);
}`,
  },

  {
    id: 'particles',
    name: 'Particles',
    blurb: 'Dissolves the video into thousands of drifting dots that take their color from the pixels beneath them.',
    type: 'particles',
    params: [
      { key: 'count', label: 'Particle count', kind: 'range', min: 1000, max: 60000, step: 500, def: 15000, help: 'How many particles are alive at once.' },
      { key: 'size', label: 'Particle size', kind: 'range', min: 1, max: 12, step: 0.5, def: 3, help: 'Diameter of each particle, in pixels.' },
      { key: 'motion', label: 'Motion', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.4, help: 'How restlessly particles wander on their own.' },
      { key: 'attraction', label: 'Image attraction', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.6, help: 'How strongly particles are pulled toward bright areas.' },
    ],
    // Per-particle state update (pos.xy, vel.zw) in a float ping-pong texture.
    updateFrag: /* glsl */ `
uniform sampler2D u_state;
uniform float u_motion, u_attraction, u_reset;
void main(){
  vec4 s = texture(u_state, v_uv);
  vec2 pos = s.xy, vel = s.zw;
  if (u_reset > 0.5) {
    pos = hash22(v_uv * 913.7 + 0.37);
    vel = vec2(0.0);
  } else {
    float e = 0.004;
    float l1 = luma(texture(u_tex, fract(pos + vec2(e, 0.0))).rgb);
    float l2 = luma(texture(u_tex, fract(pos - vec2(e, 0.0))).rgb);
    float l3 = luma(texture(u_tex, fract(pos + vec2(0.0, e))).rgb);
    float l4 = luma(texture(u_tex, fract(pos - vec2(0.0, e))).rgb);
    vel += vec2(l1 - l2, l3 - l4) * u_attraction * 0.004;
    float a = hash12(v_uv * 777.0 + fract(u_time) * 7.0) * 6.2831853;
    vel += vec2(cos(a), sin(a)) * u_motion * 0.0008;
    vel *= 0.95;
    pos = fract(pos + vel);
  }
  outColor = vec4(pos, vel);
}`,
  },
];

export const EFFECTS_BY_ID = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));

// Fresh default values for an effect's params.
export function defaultValues(effect) {
  const out = {};
  for (const p of effect.params) {
    out[p.key] = p.kind === 'xy' ? { ...p.def } : p.def;
  }
  return out;
}
