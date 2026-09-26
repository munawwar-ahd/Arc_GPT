import { useEffect, useRef } from 'react';
import { ArrowUp } from 'lucide-react';

/**
 * Liquid-metal surface for the composer's send circle.
 *
 * This is a port of the dispersion shader in
 * `ASSETS/web assets/liquid metel/signup_pill.html`. Only the rendering code
 * was taken: the pill geometry, label, plate shadow and demo controls are gone.
 *
 * The shader's `sdPill(p, b, r)` degenerates to an exact circle when
 * `b.x === b.y === r`, so the field, rim, bloom and composite passes are used
 * unmodified against a circular mask. The button element itself is untouched —
 * same tag, same 38px box, same ArrowUp icon, same submit behaviour — and the
 * canvas is painted behind it as decoration only.
 */

const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position = vec4(position,0.,1.); }`;

const HEAD = `#version 300 es
precision highp float;
out vec4 o;

uniform vec2  uC;
uniform vec2  uHalf;
uniform float uT;
uniform float uHover;
uniform float uPress;
uniform vec4  uRip[3];
uniform vec4  uRipK;
uniform vec4  uRipK2;
uniform vec4  uPtr;
uniform vec4  uPtrK;

#define PI 3.14159265

float sdPill(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return min(max(q.x,q.y),0.) + length(max(q,0.)) - r;
}

float ripple(vec2 p, float t){
  float sum = 0.;
  for(int i = 0; i < 3; i++){
    if(uRip[i].w < 0.5) continue;
    float age = t - uRip[i].z;
    if(age < 0. || age > 4.) continue;
    vec2  rp = p - uRip[i].xy;
    float facet = 1. + uRipK2.x * cos(uRipK2.y * atan(rp.y, rp.x) + age * 2.1 + float(i) * 2.4);
    float x = (length(rp) - age * uRipK.x * facet) / uRipK.y;
    sum += exp(-pow(abs(x) + 1e-4, uRipK2.z)) * exp(-age * uRipK.z);
  }
  return sum;
}

float pointerW(vec2 p){
  if(uPtr.z < 0.001) return 0.;
  float d = length(p - uPtr.xy) / uPtrK.x;
  return exp(-d*d) * uPtr.z;
}
vec2 pointerWarp(vec2 p){
  float w = pointerW(p);
  if(w <= 0.) return vec2(0.);
  return normalize(p - uPtr.xy + vec2(1e-5)) * w * (uPtrK.y + uPtrK.z * uPtr.w);
}
`;

const FRAG_RIM = HEAD + `
uniform float uBw;
uniform float uE[8];
uniform float uSat;

float perim(vec2 d, float a, float r){
  float P = 4.*a + 2.*PI*r;
  float s;
  if(d.x >= a){
    float th = atan(d.y, d.x - a); if(th < 0.) th += 2.*PI;
    s = (th <= PI*0.5) ? r*th : P - r*(2.*PI - th);
  } else if(d.x <= -a){
    float th = atan(d.y, d.x + a); if(th < 0.) th += 2.*PI;
    s = r*PI*0.5 + 2.*a + r*(th - PI*0.5);
  } else if(d.y >= 0.){
    s = r*PI*0.5 + (a - d.x);
  } else {
    s = r*PI*1.5 + 2.*a + (d.x + a);
  }
  return s / P;
}
float pb(float u, float w){ u = fract(u); float x = min(u, 1.-u); return exp(-(x*x)/(w*w)); }

float rimHot(float s, float t){
  float v = uE[0];
  v += 0.62 * pb(s - t*uE[4],             0.075);
  v += 0.44 * pb(s + t*uE[4]*0.63 + 0.41,  0.135);
  v += 0.30 * pb(s - t*uE[4]*0.34 + 0.73,  0.200);
  return v;
}
float rimBand(float sd, float off){ return 1. - smoothstep(0., uBw*1.05, abs(sd + uBw*0.55 + off)); }

void main(){
  vec2  d  = gl_FragCoord.xy - uC;
  float sd = sdPill(d, uHalf, uHalf.y);
  if(sd > uBw*2.5 || sd < -uBw*3.5){ o = vec4(0.); return; }

  float a = max(uHalf.x - uHalf.y, 0.);
  float s = perim(d, a, uHalf.y);
  float top = mix(1., 0.5 + 0.5 * (d.y / uHalf.y), uE[5]);

  vec2  p   = vec2(d.x, -d.y) / (uHalf.y * 2.);
  float lift = 1. + uPress * uE[6] + ripple(p, uT) * uE[7]
             + pointerW(p) * uPtrK.w;

  /* Without this the travelling highlight keeps the reference's full
     red-outside/cyan-inside split and reads as a neon rainbow ring. Pulling the
     three channels together leaves a bright pewter rim with only a whisper of
     prismatic edge. */
  vec3 c = vec3(
    rimBand(sd,  uE[2]) * rimHot(s + uE[3], uT),
    rimBand(sd,  0.   ) * rimHot(s,         uT),
    rimBand(sd, -uE[2]) * rimHot(s - uE[3], uT)
  );
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(lum), c, uSat);

  o = vec4(c * uE[1] * top * lift, 1.);
}`;

const FRAG_SCENE = HEAD + `
uniform float uP[21];
uniform float uSat;

float h21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.-2.*f);
  float a = h21(i), b = h21(i+vec2(1,0)), c = h21(i+vec2(0,1)), d = h21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y) * 2. - 1.;
}
float fbm(vec2 p, float g){
  float s = 0., a = 1., n = 0.;
  for(int i=0;i<4;i++){ s += a*vn(p); n += a; p = p*2.03 + 11.7; a *= g; }
  return s / n;
}
float fbm(vec2 p){ return fbm(p, 0.5); }

float wig(float x, float t, float seed){
  return vn(vec2(x,          t*0.150 + seed)) * 0.60
       + vn(vec2(x*2.07 + 4., t*0.105 + seed)) * 0.27
       + vn(vec2(x*4.30 - 7., t*0.080 + seed)) * 0.13;
}

float valleyAt(vec2 p, float t){ return wig(p.x*uP[0], t, 0.0) * uP[1]; }
float densAt  (vec2 p, float t){ return uP[2] * exp(uP[3] * wig(p.x*uP[4] + 9.0, t, 2.7)); }

float surface(vec2 p, float t){
  float V = (p.y - valleyAt(p,t)) * densAt(p,t);
  V += uP[5] * fbm(p*vec2(0.8, 1.7)*uP[6] + vec2(t*0.05, -t*0.03), uP[17]);
  return V - uP[7];
}
float tone(float v){
  float u = fract(v);
  float e = uP[9], W = uP[10] * 0.5;
  return smoothstep(0.5-W-e, 0.5-W, u) * (1. - smoothstep(0.5+W, 0.5+W+e, u));
}
vec3 spec(float t){ return clamp(vec3(1.5) - abs(4.*t - vec3(3.,2.,1.)), 0., 1.); }

void main(){
  vec2  d  = gl_FragCoord.xy - uC;
  float sd = sdPill(d, uHalf, uHalf.y);
  float pill = 1. - smoothstep(-1., 1., sd);
  float S = uHalf.y * 2.;
  float t = uT;

  if(uHover <= 0.0015 || pill <= 0.0015){ o = vec4(0., 0., 0., pill); return; }

  vec2  p = vec2(d.x, -d.y) / S;
  vec2  q = p + pointerWarp(p);

  float h0 = surface(q, t);
  vec2  gp = vec2(dFdx(h0), -dFdy(h0)) * S;
  float V  = surface(q - gp * uP[8] / max(uP[2], .001), t);

  vec2  gd = normalize(gp + vec2(1e-5));
  V += uP[13] * fbm(vec2(dot(q,gd)*uP[14], dot(q, vec2(-gd.y,gd.x))*uP[14]*0.04) + vec2(0., t*0.06));

  float rip  = ripple(p, t);
  float well = pointerW(p);
  V += rip * uRipK.w;

  const int N = 21;
  float mid = 1. - pow(0.5, uP[12]);
  vec3 col = vec3(0.), wsum = vec3(0.);
  for(int i=0;i<N;i++){
    float k = float(i)/float(N-1);
    vec3  w = spec(k);
    col  += w * tone(V + ((1. - pow(1. - k, uP[12])) - mid) * uP[11]);
    wsum += w;
  }
  col /= wsum;
  col = pow(col, vec3(uP[15]));

  /* The reference runs full Cauchy dispersion, which at circle scale floods the
     whole disc with blue and reads as a saturated neon lens rather than metal.
     Pulling the channels together keeps a hint of prismatic fringing at the
     bright fringes while the body of the disc stays neutral. */
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, uSat);
  // Faint champagne cast, so the neutral metal sits warm rather than steel-blue.
  col *= vec3(1.07, 1.0, 0.9);

  float lit = smoothstep(uP[18], uP[19], q.y - valleyAt(q, t));
  lit *= mix(1., lit, 0.55);
  col *= uP[16] * lit;

  col = col * (1. + rip * 1.15 + well * 0.60);

  o = vec4(col * pill * uHover, pill);
}`;

const FRAG_DOWN = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex, uTex2;
uniform vec2 uDstTexel;
uniform vec2 uSrcTexel;
uniform float uAdd;
void main(){
  vec2 uv = gl_FragCoord.xy * uDstTexel;
  vec2 e = uDstTexel * 0.25;
  vec4 s = texture(uTex, uv + vec2(-e.x,-e.y)) + texture(uTex, uv + vec2( e.x,-e.y))
         + texture(uTex, uv + vec2(-e.x, e.y)) + texture(uTex, uv + vec2( e.x, e.y));
  s *= 0.25;
  if(uAdd > 0.5){
    vec4 r = texture(uTex2, uv + vec2(-e.x,-e.y)) + texture(uTex2, uv + vec2( e.x,-e.y))
           + texture(uTex2, uv + vec2(-e.x, e.y)) + texture(uTex2, uv + vec2( e.x, e.y));
    s.rgb += r.rgb * 0.25;
  }
  o = s;
}`;

const FRAG_BLUR = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDir; uniform float uR;
void main(){
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 st = uTexel * uDir * uR;
  vec4 s = texture(uTex, uv) * 0.1964;
  s += (texture(uTex, uv + st*1.4118) + texture(uTex, uv - st*1.4118)) * 0.2969;
  s += (texture(uTex, uv + st*3.2941) + texture(uTex, uv - st*3.2941)) * 0.0944;
  s += (texture(uTex, uv + st*5.1765) + texture(uTex, uv - st*5.1765)) * 0.0104;
  o = s;
}`;

const FRAG_COMP = HEAD + `
uniform sampler2D uSoft, uRim, uGlow;
uniform vec2  uRes;
uniform float uGlowGain, uGlowIn, uOccl, uDim, uPunch;

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 glow = texture(uGlow, uv).rgb;

  vec2  d    = gl_FragCoord.xy - uC;
  float sd   = sdPill(d, uHalf, uHalf.y);
  float pill = 1. - smoothstep(-1., 1., sd);

  vec4 m = texture(uSoft, uv);

  float veil = 1. - smoothstep(0.46, 0.88, abs(d.y) / uHalf.y);

  vec3 metal = pow(max(m.rgb / max(m.a, 1e-3), 0.), vec3(uPunch));

  vec3 core = metal * pill * mix(1., uDim, veil) + texture(uRim, uv).rgb;

  float rip = ripple(vec2(d.x, -d.y) / (uHalf.y * 2.), uT);
  core += vec3(rip * rip) * uRipK2.w * pill * mix(1., 0.42, veil);

  float sdSh = sdPill(d + vec2(0., uHalf.y * 0.62), uHalf * 0.94, uHalf.y * 0.94);
  float occl = uOccl * exp(-max(sdSh, 0.) / (uHalf.y * 0.75));

  vec3 rgb = core + glow * uGlowGain * mix(1., uGlowIn, pill) * (1. - occl * (1. - pill));

  float a = clamp(max(rgb.r, max(rgb.g, rgb.b)), 0., 1.);
  o = vec4(min(rgb, vec3(1.)), a);
}`;

/** The metal field, retuned for a 38px circle on a black page. */
const FIELD = {
  valFreq: 0.5, valAmp: 0.55, dens: 2.4, densVar: 2.2, densFreq: 0.32,
  wobAmp: 0.12, wobFreq: 1.6, lift: 0.05, refract: 0.18, edge: 0.04,
  width: 0.46, disp: 0.2, skew: 1.0, fineAmp: 0.0, fineFreq: 9.0,
  gamma: 1.0, gain: 1.34, octGain: 0.32, litLo: -0.26, litHi: 0.1, dim: 0.72,
} as const;

/** How much of the spectral spread survives. Low = neutral gunmetal. */
const SAT = 0.28;

const RIM = {
  base: 0.2, hot: 0.82, chromA: 0.42, chromS: 0.03, speed: 0.07,
  top: 0.35, press: 0.85, ripple: 1.6,
} as const;

const MIX = {
  glow: 0.9, glowR: 0.6, glowIn: 0.3, occl: 0.62, soften: 0.3, punch: 1.5,
} as const;

const DIST = {
  speed: 1.85, width: 0.2, decay: 1.35, amp: 1.35, facet: 0.18, lobes: 6.0,
  sharp: 1.15, emit: 0.45, ptrRad: 0.55, ptrAmp: 0.32, ptrFast: 0.4,
  ptrRim: 0.8, ptrLag: 0.0016, ptrVref: 4.5,
} as const;

const FIELD_KEYS = Object.keys(FIELD) as (keyof typeof FIELD)[];
const RIM_KEYS = Object.keys(RIM) as (keyof typeof RIM)[];

interface SendButtonProps {
  disabled: boolean;
}

export function SendButton({ disabled }: SendButtonProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const button = buttonRef.current;
    if (!canvas || !host || !button) return;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });

    // No WebGL2 (or context lost): the CSS fallback surface stands in, so the
    // send button still reads as a control and still works.
    if (!gl) {
      host.dataset.fallback = 'true';
      return;
    }

    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
      }
      return s;
    };

    const program = (fs: string) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'position');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(p) ?? 'link failed');
      }
      const u: Record<string, WebGLUniformLocation | null> = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < n; i += 1) {
        const info = gl.getActiveUniform(p, i);
        if (!info) continue;
        const name = info.name.replace('[0]', '');
        u[name] = gl.getUniformLocation(p, info.name);
      }
      return { p, u };
    };

    let scene: ReturnType<typeof program>;
    let rim: ReturnType<typeof program>;
    let down: ReturnType<typeof program>;
    let blur: ReturnType<typeof program>;
    let comp: ReturnType<typeof program>;
    try {
      scene = program(FRAG_SCENE);
      rim = program(FRAG_RIM);
      down = program(FRAG_DOWN);
      blur = program(FRAG_BLUR);
      comp = program(FRAG_COMP);
    } catch {
      host.dataset.fallback = 'true';
      return;
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const half = gl.getExtension('EXT_color_buffer_half_float');

    const makeTarget = () => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo, w: 0, h: 0 };
    };

    const sizeTarget = (t: { tex: WebGLTexture; w: number; h: number }, w: number, h: number) => {
      if (t.w === w && t.h === h) return;
      t.w = w;
      t.h = h;
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      if (half) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
    };

    const targets = Array.from({ length: 6 }, makeTarget);
    const [T_core, T_rim, T_s1, T_s2, T_a, T_b] = targets;

    let W = 0;
    let H = 0;
    let BW = 0;
    let BH = 0;
    let CX = 0;
    let CY = 0;
    let needsResize = true;

    const resize = () => {
      // The drawing buffer must match the *canvas* box, not the 38px host: the
      // canvas is deliberately larger so the bloom has somewhere to land, and
      // the circle is positioned relative to the canvas centre.
      const cr = canvas.getBoundingClientRect();
      const br = button.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(cr.width * dpr));
      const h = Math.max(2, Math.round(cr.height * dpr));
      if (w !== W || h !== H) {
        W = w;
        H = h;
        canvas.width = W;
        canvas.height = H;
      }
      BW = br.width * dpr;
      BH = br.height * dpr;
      CX = (br.left - cr.left) * dpr + BW / 2;
      CY = H - ((br.top - cr.top) * dpr + BH / 2);
      sizeTarget(T_core, W, H);
      sizeTarget(T_rim, W, H);
      const hw = Math.max(2, Math.ceil(W / 2));
      const hh = Math.max(2, Math.ceil(H / 2));
      sizeTarget(T_s1, hw, hh);
      sizeTarget(T_s2, hw, hh);
      sizeTarget(T_a, W, H);
      sizeTarget(T_b, W, H);
      needsResize = false;
    };

    const ro = new ResizeObserver(() => {
      needsResize = true;
    });
    ro.observe(host);

    const drawTo = (t: { fbo: WebGLFramebuffer; w: number; h: number } | null) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
      gl.viewport(0, 0, t ? t.w : W, t ? t.h : H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const uArr = new Float32Array(FIELD_KEYS.length);
    const eArr = new Float32Array(RIM_KEYS.length);
    let hover = 1;
    let heat = 0;
    let heatTarget = 0;
    let press = 0;
    let pressTarget = 0;
    let clock = 0;
    let last = performance.now();
    let raf = 0;

    const RIP = [0, 1, 2].map(() => ({ x: 0, y: 0, t: -99, on: 0 }));
    const ripArr = new Float32Array(12);
    let ripNext = 0;
    const ptr = { x: 0, y: 0 };
    const ptrS = { x: 0, y: 0 };
    let ptrAmt = 0;
    let ptrSpeed = 0;

    const addRipple = (x: number, y: number) => {
      const r = RIP[ripNext];
      ripNext = (ripNext + 1) % RIP.length;
      r.x = x;
      r.y = y;
      r.t = clock;
      r.on = 1;
    };

    const localPt = (e: PointerEvent) => {
      const b = button.getBoundingClientRect();
      const s = b.height;
      return [(e.clientX - (b.left + b.width / 2)) / s, (e.clientY - (b.top + b.height / 2)) / s];
    };

    const onEnter = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const [x, y] = localPt(e);
      ptr.x = x;
      ptr.y = y;
      ptrS.x = x;
      ptrS.y = y;
      ptrSpeed = 0;
      heatTarget = 1;
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      heatTarget = 0;
    };
    const onDown = (e: PointerEvent) => {
      const [x, y] = localPt(e);
      ptr.x = x;
      ptr.y = y;
      pressTarget = 1;
      addRipple(x, y);
    };
    const onUp = () => {
      pressTarget = 0;
    };
    const onFocus = () => {
      if (button.matches(':focus-visible')) heatTarget = 1;
    };
    const onBlur = () => {
      heatTarget = 0;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
      pressTarget = 1;
      addRipple(0, 0);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      pressTarget = 0;
    };
    const onMove = (e: PointerEvent) => {
      if (heatTarget <= 0 && pressTarget <= 0) return;
      const [x, y] = localPt(e);
      ptr.x = x;
      ptr.y = y;
    };

    button.addEventListener('pointerenter', onEnter);
    button.addEventListener('pointerleave', onLeave);
    button.addEventListener('pointerdown', onDown);
    button.addEventListener('keydown', onKeyDown);
    button.addEventListener('keyup', onKeyUp);
    button.addEventListener('focus', onFocus);
    button.addEventListener('blur', onBlur);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    const frame = (now: number) => {
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      if (!calm.matches) clock += dt;

      const hk = heatTarget > heat ? 1 - Math.pow(0.0012, dt) : 1 - Math.pow(0.00012, dt);
      heat += (heatTarget - heat) * hk;
      if (Math.abs(heatTarget - heat) < 0.0008) heat = heatTarget;

      const pk = pressTarget > press ? 1 - Math.pow(1e-9, dt) : 1 - Math.pow(0.004, dt);
      press += (pressTarget - press) * pk;
      if (Math.abs(pressTarget - press) < 0.002) press = pressTarget;

      hover = 1;

      for (let i = 0; i < RIP.length; i += 1) {
        const r = RIP[i];
        if (r.on && clock - r.t > 4) r.on = 0;
        ripArr[i * 4] = r.x;
        ripArr[i * 4 + 1] = r.y;
        ripArr[i * 4 + 2] = r.t;
        ripArr[i * 4 + 3] = r.on;
      }

      const lag = 1 - Math.pow(DIST.ptrLag, dt);
      const dx = (ptr.x - ptrS.x) * lag;
      const dy = (ptr.y - ptrS.y) * lag;
      ptrS.x += dx;
      ptrS.y += dy;
      const inst = Math.min(Math.hypot(dx, dy) / Math.max(dt, 1e-3) / DIST.ptrVref, 1);
      ptrSpeed += (inst - ptrSpeed) * (1 - Math.pow(inst > ptrSpeed ? 0.001 : 0.02, dt));
      const wantWell = heatTarget > 0 || pressTarget > 0 ? 1 : 0;
      ptrAmt += (wantWell - ptrAmt) * (1 - Math.pow(0.004, dt));
      if (Math.abs(wantWell - ptrAmt) < 0.002) ptrAmt = wantWell;

      if (needsResize) resize();

      // Under reduced motion the field is frozen, so redraw only when the
      // interaction state or the box actually changes.
      const still = calm.matches && RIP.every((r) => !r.on) && ptrAmt < 0.002;
      if (still && !needsResize && Math.abs(heatTarget - heat) < 0.002 && press === pressTarget) {
        raf = requestAnimationFrame(frame);
        return;
      }

      for (let i = 0; i < uArr.length; i += 1) uArr[i] = FIELD[FIELD_KEYS[i]];
      for (let i = 0; i < eArr.length; i += 1) eArr[i] = RIM[RIM_KEYS[i]];

      const bw = Math.max(1.5, 3.2 * (BH / 516));
      const gain = FIELD.gain * (1 + heat * 0.22 + press * 0.12);

      gl.useProgram(scene.p);
      gl.uniform2f(scene.u.uC, CX, CY);
      gl.uniform2f(scene.u.uHalf, BW / 2, BH / 2);
      gl.uniform1f(scene.u.uT, clock);
      gl.uniform1f(scene.u.uHover, hover);
      gl.uniform1f(scene.u.uPress, press);
      gl.uniform1f(scene.u.uSat, SAT);
      gl.uniform4fv(scene.u.uRip, ripArr);
      gl.uniform4f(scene.u.uRipK, DIST.speed, DIST.width, DIST.decay, DIST.amp);
      gl.uniform4f(scene.u.uRipK2, DIST.facet, DIST.lobes, DIST.sharp, DIST.emit);
      gl.uniform4f(scene.u.uPtr, ptrS.x, ptrS.y, ptrAmt, ptrSpeed);
      gl.uniform4f(scene.u.uPtrK, DIST.ptrRad, DIST.ptrAmp, DIST.ptrFast, DIST.ptrRim);
      uArr[16] = gain;
      gl.uniform1fv(scene.u.uP, uArr);
      drawTo(T_core);

      gl.useProgram(rim.p);
      gl.uniform2f(rim.u.uC, CX, CY);
      gl.uniform2f(rim.u.uHalf, BW / 2, BH / 2);
      gl.uniform1f(rim.u.uT, clock);
      gl.uniform1f(rim.u.uBw, bw);
      gl.uniform1f(rim.u.uPress, press);
      gl.uniform1f(rim.u.uSat, SAT);
      gl.uniform4fv(rim.u.uRip, ripArr);
      gl.uniform4f(rim.u.uRipK, DIST.speed, DIST.width, DIST.decay, DIST.amp);
      gl.uniform4f(rim.u.uRipK2, DIST.facet, DIST.lobes, DIST.sharp, DIST.emit);
      gl.uniform4f(rim.u.uPtr, ptrS.x, ptrS.y, ptrAmt, ptrSpeed);
      gl.uniform4f(rim.u.uPtrK, DIST.ptrRad, DIST.ptrAmp, DIST.ptrFast, DIST.ptrRim);
      eArr[0] = RIM.base + heat * 0.12;
      eArr[1] = RIM.hot + heat * 0.18;
      gl.uniform1fv(rim.u.uE, eArr);
      drawTo(T_rim);

      gl.useProgram(down.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, T_core.tex);
      gl.uniform1i(down.u.uTex, 0);
      gl.uniform1f(down.u.uAdd, 0);
      gl.uniform2f(down.u.uDstTexel, 1 / T_s1.w, 1 / T_s1.h);
      gl.uniform2f(down.u.uSrcTexel, 1 / W, 1 / H);
      drawTo(T_s1);

      gl.useProgram(blur.p);
      gl.uniform1i(blur.u.uTex, 0);
      gl.uniform2f(blur.u.uTexel, 1 / T_s1.w, 1 / T_s1.h);
      const sigTex = MIX.soften * (BH * 0.5) * 0.95;
      if (sigTex > 0.1) {
        const iters = Math.min(4, Math.max(1, Math.ceil(sigTex / 3.0)));
        gl.uniform1f(blur.u.uR, sigTex / Math.sqrt(iters) / 1.95);
        for (let i = 0; i < iters; i += 1) {
          gl.bindTexture(gl.TEXTURE_2D, T_s1.tex);
          gl.uniform2f(blur.u.uDir, 1, 0);
          drawTo(T_s2);
          gl.bindTexture(gl.TEXTURE_2D, T_s2.tex);
          gl.uniform2f(blur.u.uDir, 0, 1);
          drawTo(T_s1);
        }
      }

      gl.useProgram(down.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, T_s1.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, T_rim.tex);
      gl.uniform1i(down.u.uTex, 0);
      gl.uniform1i(down.u.uTex2, 1);
      gl.uniform1f(down.u.uAdd, 1);
      gl.uniform2f(down.u.uDstTexel, 1 / T_a.w, 1 / T_a.h);
      gl.uniform2f(down.u.uSrcTexel, 1 / T_s1.w, 1 / T_s1.h);
      drawTo(T_a);

      gl.useProgram(blur.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(blur.u.uTex, 0);
      gl.uniform2f(blur.u.uTexel, 1 / T_a.w, 1 / T_a.h);
      // The reference sized the bloom off a downsampled target; at circle scale
      // the radii are pinned to a small fixed spread so the glow stays inside
      // the composer's own rounded clip instead of being cut off at its edge.
      for (const r of [1.0, 2.3, 5.2, 9.0].map((v) => v * MIX.glowR * 0.32)) {
        gl.uniform1f(blur.u.uR, r);
        gl.bindTexture(gl.TEXTURE_2D, T_a.tex);
        gl.uniform2f(blur.u.uDir, 1, 0);
        drawTo(T_b);
        gl.bindTexture(gl.TEXTURE_2D, T_b.tex);
        gl.uniform2f(blur.u.uDir, 0, 1);
        drawTo(T_a);
      }

      gl.useProgram(comp.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, T_s1.tex);
      gl.uniform1i(comp.u.uSoft, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, T_rim.tex);
      gl.uniform1i(comp.u.uRim, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, T_a.tex);
      gl.uniform1i(comp.u.uGlow, 2);
      gl.uniform2f(comp.u.uRes, W, H);
      gl.uniform2f(comp.u.uC, CX, CY);
      gl.uniform2f(comp.u.uHalf, BW / 2, BH / 2);
      gl.uniform1f(comp.u.uT, clock);
      gl.uniform4fv(comp.u.uRip, ripArr);
      gl.uniform4f(comp.u.uRipK, DIST.speed, DIST.width, DIST.decay, DIST.amp);
      gl.uniform4f(comp.u.uRipK2, DIST.facet, DIST.lobes, DIST.sharp, DIST.emit);
      gl.uniform1f(comp.u.uGlowGain, MIX.glow);
      gl.uniform1f(comp.u.uGlowIn, MIX.glowIn);
      gl.uniform1f(comp.u.uOccl, MIX.occl);
      gl.uniform1f(comp.u.uDim, FIELD.dim);
      gl.uniform1f(comp.u.uPunch, MIX.punch);
      drawTo(null);

      raf = requestAnimationFrame(frame);
    };

    resize();
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      button.removeEventListener('pointerenter', onEnter);
      button.removeEventListener('pointerleave', onLeave);
      button.removeEventListener('pointerdown', onDown);
      button.removeEventListener('keydown', onKeyDown);
      button.removeEventListener('keyup', onKeyUp);
      button.removeEventListener('focus', onFocus);
      button.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      for (const t of targets) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      for (const pr of [scene, rim, down, blur, comp]) gl.deleteProgram(pr.p);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
    };
  }, []);

  return (
    <span className="arc-send-surface" ref={hostRef} data-disabled={disabled ? 'true' : undefined}>
      <canvas className="arc-send-canvas" ref={canvasRef} aria-hidden="true" />
      <button
        className="arc-send-button"
        ref={buttonRef}
        type="submit"
        disabled={disabled}
        aria-label="Send message"
        title="Send message"
      >
        <ArrowUp size={17} strokeWidth={1.8} />
      </button>
    </span>
  );
}
