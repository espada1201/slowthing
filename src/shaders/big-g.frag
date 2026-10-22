// World III: light around a Schwarzschild black hole, marched per pixel with the same maths as
// src/physics/schwarzschild.ts (coordinateDirection, x'' = −(3/2) rs h² x / r⁵ by velocity-Verlet with
// steps k·r/|v|, asymptoticDirection for the leftover bending; reflect.glsl prepended). Lengths are in scene units of uScale
// metres so r⁵ stays finite for any rs. The observer hovers: a static observer's local frame.
uniform vec3 uCamPos;
uniform mat3 uCamRot;
uniform vec2 uTan;
uniform float uScale;
uniform float uRs;          // Schwarzschild radius, scene units
uniform float uBend;        // 1 = light bends, 0 = straight rays (for comparison)
uniform float uHorizon;     // horizon radius once collapsed, else 0
uniform float uRock;        // boulder radius while it still stands, else 0
uniform vec2 uDeck;         // platform inner / outer radius
uniform vec3 uLamps[10];    // self-luminous spheres: 4 buoys near the hole, 6 beacons on the deck
uniform vec3 uLampColors[10];
uniform float uLampRadii[10];
uniform float uLampDist[10];
uniform int uSteps;
uniform float uK;
uniform float uFar;
uniform float uRedshift;
uniform float uGuide;
uniform float uShadow;      // shadow angular radius, radians (< 0: no horizon)
uniform float uPixel;       // angle subtended by one pixel
uniform vec3 uSun;
uniform vec3 uPlanetDir;
uniform vec3 uPlanetAxis;
uniform float uPlanetSize;
uniform vec3 uGalaxy;
uniform float uDebug;       // 1: output the escape direction as 0.4 + 0.3·dir (alpha 0 captured, 0.5 unfinished)
varying vec2 vUv;

const float TAU = 6.2831853;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec4 hash43(vec3 p) {
  vec4 q = fract(vec4(p.xyzx) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise3(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return s;
}

// ---------- sky at infinity ----------
vec3 galaxy(vec3 d, out float band) {
  float g = dot(d, uGalaxy);
  band = exp(-g * g / 0.03);
  float n = fbm(d * 3.5);
  float lane = smoothstep(0.42, 0.72, fbm(d * 8.0 + 7.0)) * exp(-(g - 0.02) * (g - 0.02) / 0.0025);
  vec3 col = vec3(0.80, 0.69, 0.53) * band * (0.012 + 0.07 * n * n) * (1.0 - 0.85 * lane);
  col += vec3(0.82, 0.24, 0.13) * band * 0.03 * smoothstep(0.6, 0.85, fbm(d * 6.0 + 21.0));
  return col;
}

const float STAR_GRID = 150.0;
// Stars are blurred over about a pixel. On pixels coarser than this (radians), e.g. a phone at low quality,
// each star keeps its total light instead of brightening with its wider blur, so the sky is not a snowstorm.
const float STAR_REF_PIXEL = 0.0027;
vec3 stars(vec3 d, float band) {
  vec3 ad = abs(d);
  vec2 uv;
  float face;
  if (ad.x >= ad.y && ad.x >= ad.z) { uv = d.yz / ad.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (ad.y >= ad.z) { uv = d.xz / ad.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else { uv = d.xy / ad.z; face = d.z > 0.0 ? 4.0 : 5.0; }
  vec2 g = (uv * 0.5 + 0.5) * STAR_GRID;
  vec2 cell = floor(g);
  float unit = 2.0 / STAR_GRID / (1.0 + 0.5 * dot(uv, uv));
  float sigma = max(uPixel * 0.7, 2e-5);
  float flux = min(1.0, pow(STAR_REF_PIXEL / max(uPixel, 1e-6), 2.0));
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(i, j);
      vec4 h = hash43(vec3(c, face * 37.0 + 3.0));
      if (h.z > 0.16 + 0.34 * band) continue;
      float dist = length(g - c - h.xy) * unit;
      float mag = 0.025 + 0.2 * pow(h.w, 6.0) + 7.0 * pow(h.w, 60.0);
      float t = fract(h.w * 13.7 + h.x * 7.1);
      vec3 tint = t < 0.3 ? mix(vec3(1.0, 0.6, 0.36), vec3(1.0, 0.85, 0.68), t / 0.3) : mix(vec3(1.0, 0.95, 0.9), vec3(0.74, 0.84, 1.0), (t - 0.3) / 0.7);
      acc += tint * mag * flux * exp(-0.5 * dist * dist / (sigma * sigma));
    }
  }
  return acc;
}

// A ringed gas giant far away (treated as at infinity). rgb is its colour, a its coverage.
vec4 planet(vec3 d) {
  if (dot(d, uPlanetDir) < cos(uPlanetSize * 2.4)) return vec4(0.0);
  vec3 w = -uPlanetDir;
  vec3 e1 = normalize(cross(uPlanetAxis, w));
  vec3 e2 = cross(w, e1);
  vec2 q = vec2(dot(d, e1), dot(d, e2)) / sin(uPlanetSize);
  float q2 = dot(q, q);
  vec4 outc = vec4(0.0);
  float zs = q2 < 1.0 ? sqrt(1.0 - q2) : -1.0;
  if (q2 < 1.0) {
    vec3 N = e1 * q.x + e2 * q.y + w * zs;
    float lat = dot(N, uPlanetAxis);
    float bands = 0.5 + 0.5 * sin(lat * 23.0 + 1.6 * fbm(N * 5.0));
    vec3 base = mix(vec3(0.70, 0.46, 0.22), vec3(0.90, 0.83, 0.68), bands);
    base = mix(base, vec3(0.62, 0.18, 0.08), 0.65 * smoothstep(0.75, 0.95, sin(lat * 8.0 + 1.3)));
    float light = max(dot(N, uSun), 0.0);
    outc = vec4(base * (0.03 + 1.05 * light) * (0.65 + 0.35 * zs), 1.0);
  }
  float aw = dot(uPlanetAxis, w);
  float zr = -(q.x * dot(uPlanetAxis, e1) + q.y * dot(uPlanetAxis, e2)) / aw;
  float rr = sqrt(q2 + zr * zr);
  if (rr > 1.35 && rr < 2.3 && (q2 >= 1.0 || zr > zs)) {
    float t = (rr - 1.35) / 0.95;
    float dens = (0.6 + 0.4 * sin(rr * 41.0) * sin(rr * 13.0)) * smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.9, t);
    dens *= 1.0 - 0.9 * smoothstep(0.40, 0.43, t) * smoothstep(0.52, 0.49, t);
    float lit = dot(uPlanetAxis, uSun) * sign(aw) > 0.0 ? 1.0 : 0.3;
    vec3 rc = mix(vec3(0.86, 0.79, 0.64), vec3(0.6, 0.45, 0.25), t) * lit;
    float alpha = clamp(dens, 0.0, 1.0) * 0.85;
    outc = vec4(mix(outc.rgb, rc, alpha), max(outc.a, alpha));
  }
  return outc;
}

vec3 sky(vec3 d) {
  float band;
  vec3 col = vec3(0.0016, 0.0019, 0.0028) + galaxy(d, band) + stars(d, band);
  float a = length(d - uSun);
  col += vec3(1.0, 0.93, 0.82) * (30.0 * smoothstep(0.011, 0.008, a) + 0.4 * exp(-a * a / 0.002) + 0.02 * exp(-a / 0.2));
  vec4 p = planet(d);
  return mix(col, p.rgb, p.a);
}

// ---------- scenery ----------
float segSphere(vec3 a, vec3 b, vec3 c, float R) {
  vec3 d = b - a, f = a - c;
  float A = dot(d, d), B = dot(f, d), C = dot(f, f) - R * R;
  float disc = B * B - A * C;
  if (disc < 0.0) return 2.0;
  float t = (-B - sqrt(disc)) / A;
  return t >= 0.0 && t <= 1.0 ? t : 2.0;
}

// Leftover bending after the march stops (asymptoticDirection in schwarzschild.ts).
vec3 escapeDirection(vec3 x, vec3 v, float rs) {
  vec3 vh = normalize(v);
  vec3 perp = x - vh * dot(x, vh);
  float b = length(perp);
  if (b < 1e-6 || rs <= 0.0) return vh;
  float s = dot(x, vh) / length(x);
  return normalize(vh - perp / b * (1.5 * rs / b * (2.0 / 3.0 - s + s * s * s / 3.0)));
}

// Box-filtered checkerboard (p in tiles, dx/dy its screen derivatives) so lensed, squeezed tiles fade
// to grey instead of shimmering.
float checker(vec2 p, vec2 dx, vec2 dy) {
  vec2 w = clamp(max(abs(dx), abs(dy)), 1e-4, 1.0);
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y;
}

void deck(vec3 p, float side, vec2 dx, vec2 dy, out vec3 refl, out vec3 emit) {
  vec2 q = p.xz * uScale;
  float pr = length(q);
  float inner = uDeck.x * uScale, outer = uDeck.y * uScale;
  float odd = checker(q / 3.0, dx, dy);
  vec3 albedo = side > 0.0
    ? mix(vec3(0.80, 0.74, 0.62), vec3(0.030, 0.034, 0.042), odd)
    : mix(vec3(0.46, 0.31, 0.11), vec3(0.15, 0.09, 0.035), odd);
  albedo = mix(albedo, vec3(0.62, 0.07, 0.025), step(pr, inner + 1.2));
  albedo = mix(albedo, vec3(0.55, 0.40, 0.14), step(outer - 1.0, pr));
  float ndl = max(side * uSun.y, 0.0);
  refl = albedo * (0.08 + 0.95 * ndl + (side < 0.0 ? 0.22 : 0.0));
  emit = vec3(0.0);
  if (side > 0.0) {
    float phi = atan(q.y, q.x);
    for (int k = 0; k < 4; k++) {
      float R = k == 0 ? inner + 2.0 : (k == 1 ? 21.0 : (k == 2 ? 31.0 : outer - 2.4));
      float N = floor(TAU * R / 6.0);
      float arc = (fract(phi / TAU * N + 0.5) - 0.5) * TAU * R / N;
      float dr = pr - R;
      emit += vec3(1.0, 0.62, 0.3) * 1.3 * smoothstep(0.045, 0.02, arc * arc + dr * dr);
    }
  }
}

vec3 rockColor(vec3 p) {
  vec3 pm = p * uScale;
  vec3 n = normalize(p);
  float f = fbm(pm * 1.8);
  vec3 albedo = mix(vec3(0.22, 0.21, 0.2), vec3(0.42, 0.40, 0.37), f);
  // Granite grains a few centimetres across: pale feldspar and dark mica.
  albedo = mix(albedo, vec3(0.72, 0.67, 0.6), smoothstep(0.6, 0.78, noise3(pm * 26.0)));
  albedo = mix(albedo, vec3(0.07, 0.07, 0.075), 0.8 * smoothstep(0.64, 0.8, noise3(pm * 33.0 + 9.0)));
  albedo *= 0.85 + 0.3 * noise3(pm * 61.0);
  return albedo * (0.05 + 0.95 * max(dot(n, uSun), 0.0));
}

void main() {
  vec3 n = normalize(uCamRot * vec3((vUv.x * 2.0 - 1.0) * uTan.x, (vUv.y * 2.0 - 1.0) * uTan.y, -1.0));
  vec3 x = uCamPos;
  float rObs = length(x);
  vec3 rh = x / rObs;
  float rsB = uRs * uBend;
  float radial = dot(n, rh);
  vec3 v = rh * radial * sqrt(max(0.0, 1.0 - rsB / rObs)) + (n - rh * radial);
  vec3 L = cross(x, v);
  float coef = -1.5 * rsB * dot(L, L);
  vec3 a = coef * x / pow(rObs, 5.0);

  int kind = 0; // 0 sky, 1 shadow, 2 deck, 3 rock, 4 lamp
  int which = 0;
  vec3 hp = vec3(0.0);
  float side = 1.0;
  bool done = false;
  for (int i = 0; i < 2000; i++) {
    if (i >= uSteps) break;
    float r = length(x);
    if (r < uHorizon * 1.0001) { kind = 1; done = true; break; }
    if (r > uFar && dot(x, v) > 0.0) { done = true; break; }
    float h = uK * r / length(v);
    float seg = uK * r * 1.5;
    vec3 xn = x + v * h + 0.5 * a * (h * h);
    float best = 2.0;
    if ((x.y > 0.0) != (xn.y > 0.0)) {
      float t = x.y / (x.y - xn.y);
      vec3 p = mix(x, xn, t);
      float pr = length(p.xz);
      if (pr > uDeck.x && pr < uDeck.y && pr > uHorizon) { best = t; kind = 2; hp = p; side = x.y > 0.0 ? 1.0 : -1.0; }
    }
    if (uRock > 0.0 && r - seg < uRock) {
      float t = segSphere(x, xn, vec3(0.0), uRock);
      if (t < best) { best = t; kind = 3; hp = mix(x, xn, t); }
    }
    for (int k = 0; k < 10; k++) {
      if (uLampRadii[k] <= 0.0 || abs(uLampDist[k] - r) > uLampRadii[k] + seg) continue;
      float t = segSphere(x, xn, uLamps[k], uLampRadii[k]);
      if (t < best) { best = t; kind = 4; which = k; hp = mix(x, xn, t); }
    }
    if (best < 1.5) { done = true; break; }
    vec3 an = coef * xn / pow(length(xn), 5.0);
    v += 0.5 * (a + an) * h;
    x = xn;
    a = an;
  }
  // Screen derivatives of the deck coordinates, taken here where every pixel's control flow has rejoined.
  vec2 deckUV = hp.xz * (uScale / 3.0);
  vec2 dU = dFdx(deckUV), dV = dFdy(deckUV);
  if (uDebug > 0.5) {
    gl_FragColor = kind == 1 ? vec4(0.0) : (done ? vec4(0.4 + 0.3 * escapeDirection(x, v, rsB), 1.0) : vec4(0.0, 0.0, 0.0, 0.5));
    return;
  }
  // A ray still circling close to the hole when the step budget runs out is (nearly) captured.
  if (!done && uHorizon > 0.0 && length(x) < 3.0 * uRs) kind = 1;

  // Gravitational frequency shift for this hovering observer. Starlight arrives blueshifted by
  // 1/√(1 − rs/r); light emitted at r_e by √((1 − rs/r_e)/(1 − rs/r)); reflected starlight mixes both.
  float lapseObs = max(1.0 - uRs / rObs, 1e-6);
  float on = uRedshift;
  float Dsky = on > 0.5 ? inversesqrt(lapseObs) : 1.0;
  vec3 col = vec3(0.0);
  if (kind == 0) {
    vec3 s = sky(escapeDirection(x, v, rsB));
    col = on > 0.5 ? dopplerShift(s, Dsky, 0.0) * pow(Dsky, 5.0) : s;
  } else if (kind >= 2) {
    vec3 refl, emit = vec3(0.0);
    float rEmit = length(hp);
    if (kind == 2) deck(hp, side, dU, dV, refl, emit);
    else if (kind == 3) refl = rockColor(hp);
    else {
      vec3 nrm = normalize(hp - uLamps[which]);
      refl = vec3(0.0);
      emit = uLampColors[which] * (0.55 + 0.45 * max(dot(nrm, -n), 0.0)) * 2.2;
    }
    if (on > 0.5) {
      // Reflected starlight: the surface's colours shift by De (surface → eye), the light itself by Dsky (infinity → eye).
      float De = sqrt(max(1.0 - uRs / rEmit, 0.0) / lapseObs);
      vec3 light[KNOTS];
      for (int p = 0; p < KNOTS; p++) light[p] = sunlight(knotLambda(p) * Dsky) * refl;
      col = reflectKnots(De, light) * pow(Dsky, 5.0) + dopplerShift(emit, De, 1.0) * pow(De, 5.0);
    } else {
      col = refl + emit;
    }
  }

  // The guide sits on the sky behind everything, so a lamp in front of it hides it.
  if (uGuide > 0.5 && uShadow > 0.0 && kind != 4) {
    vec3 toHole = -normalize(uCamPos);
    float ang = 2.0 * asin(clamp(0.5 * length(n - toHole), 0.0, 1.0));
    float line = 1.0 - smoothstep(0.6 * uPixel, 1.7 * uPixel, abs(ang - uShadow));
    vec3 e1 = normalize(abs(toHole.y) < 0.99 ? cross(toHole, vec3(0.0, 1.0, 0.0)) : cross(toHole, vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(toHole, e1);
    line *= step(0.45, fract(atan(dot(n, e2), dot(n, e1)) / TAU * 90.0));
    col = mix(col, vec3(0.9, 0.2, 0.09), line);
  }
  gl_FragColor = vec4(linearToSRGB(softClip(col)), 1.0);
}
