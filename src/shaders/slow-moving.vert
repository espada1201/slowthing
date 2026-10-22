// Objects on circular paths, drawn where they were when the light now reaching the eye left them (boost.glsl prepended).
// Solves c·(t − t_r) = |x_obs − x(t_r)| per vertex by Newton's method kept inside a bracket around the
// root (as physics/relativity.ts does): unguarded, Newton overshoots and cycles for a fast object seen from afar.
// With light delay off, they are drawn at the observer's now instead (physics/simultaneity.ts), solved the same way.
attribute vec3 aColor;
attribute float aPattern;
#ifdef PROOF
attribute vec2 aReadout;  // proofs.ts: this vertex's readout pixel, in clip space
#endif
uniform vec3 uObs;
uniform float uC;
uniform float uPhase;     // path angle at the observer's current world time
uniform float uOmega;     // angular speed, rad/s (sign = direction)
uniform float uRadius;
uniform vec3 uCenter;
uniform float uGamma;     // Lorentz factor of the object's speed
uniform float uBeta;      // object's speed / c
uniform float uRetard;    // 1 = finite light speed, 0 = at the observer's now
uniform vec3 uObsBeta;    // the observer's velocity / c
uniform float uContract;  // 1 = Lorentz contraction
uniform float uTauNow;    // object's proper time at the observer's current world time
uniform vec3 uSun;
uniform float uAberrationOn;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vPattern;
varying float vDsrc;
varying float vTau;
varying float vDin;       // Doppler factor of the sunlight the object receives, in its own frame
varying vec3 vSunLocal;   // direction of the sun as seen from the moving object
varying vec3 vVelocity;   // object velocity / c

// sin and cos to float32 accuracy (π/2 reduction in three parts, then the Cephes polynomials). Some GPUs'
// built-ins are good only to 1e-4, a centimetre on the tram's loop, which the light-cone solve can magnify.
vec2 sinCos(float a) {
  float q = floor(a * 0.63661977 + 0.5);
  float r = ((a - q * 1.5703125) - q * 4.8375129699707031e-4) - q * 7.5497899548918821e-8;
  float z = r * r;
  float s = r + r * z * (-1.6666654611e-1 + z * (8.3321608736e-3 - z * 1.9515295891e-4));
  float c = 1.0 - 0.5 * z + z * z * (4.1666645683e-2 + z * (-1.3887316255e-3 + z * 2.4433157118e-5));
  int k = int(q - 4.0 * floor(0.25 * q));
  return k == 0 ? vec2(s, c) : k == 1 ? vec2(c, -s) : k == 2 ? vec2(-s, -c) : vec2(-c, s);
}

vec3 pathPos(float a, vec3 local) {
  vec2 sc = sinCos(a);
  vec3 radial = vec3(sc.y, 0.0, sc.x);
  vec3 forward = vec3(-sc.x, 0.0, sc.y) * sign(uOmega);
  float k = uContract > 0.5 ? 1.0 / uGamma : 1.0;
  return uCenter + uRadius * radial + forward * local.x * k + vec3(0.0, local.y, 0.0) + radial * local.z;
}

// That point's velocity, d pathPos / dt: the object turns as it goes round, so its outer and leading
// points move faster than the track's centre line.
vec3 pathVel(float a, vec3 local) {
  vec2 sc = sinCos(a);
  vec3 radial = vec3(sc.y, 0.0, sc.x);
  vec3 forward = vec3(-sc.x, 0.0, sc.y) * sign(uOmega);
  float k = uContract > 0.5 ? 1.0 / uGamma : 1.0;
  return abs(uOmega) * ((uRadius + local.z) * forward - radial * local.x * k);
}

void main() {
  float delta = 0.0;
  if (uRetard > 0.5) {
    // The vertex circles at radius rho about a point dc from the eye, so the light delay lies within
    // [|dc − rho|, dc + rho] / c, and f(delta) = −c·delta − |x_obs − x| falls through zero inside it.
    // A Newton step that would leave the bracket goes to the bound it crossed if no evaluation has moved
    // that bound yet (the root often sits right by it, where the object passes nearest or farthest), else bisects.
    float rho = length(pathPos(0.0, position).xz - uCenter.xz);
    float dc = length(uObs - uCenter - vec3(0.0, position.y, 0.0));
    float lo = -(dc + rho) / uC;
    float hi = -abs(dc - rho) / uC;
    bool loSeen = false, hiSeen = false;
    delta = clamp(-dc / uC, lo, hi);
    for (int i = 0; i < 12; i++) {
      float a = uPhase + uOmega * delta;
      vec3 d = uObs - pathPos(a, position);
      float dist = max(length(d), 1e-4);
      float f = -uC * delta - dist;
      if (f > 0.0) { lo = delta; loSeen = true; } else { hi = delta; hiSeen = true; }
      float next = delta - f / (-uC + dot(d, pathVel(a, position)) / dist);
      if (!(next >= lo)) next = loSeen ? 0.5 * (lo + hi) : lo;
      else if (!(next <= hi)) next = hiSeen ? 0.5 * (lo + hi) : hi;
      delta = next;
    }
  } else {
    // The event at the observer's now: delta = β·(x − x_obs)/c. On its circle of radius rho the vertex is within
    // |β|·rho of the centre along β, which brackets delta; the slope 1 − β·v/c is positive below light speed.
    vec3 centre = uCenter + vec3(0.0, position.y, 0.0);
    float rho = length(pathPos(0.0, position).xz - uCenter.xz);
    float mid = dot(uObsBeta, centre - uObs) / uC;
    float lo = mid - length(uObsBeta) * rho / uC;
    float hi = mid + length(uObsBeta) * rho / uC;
    delta = mid;
    for (int i = 0; i < 12; i++) {
      float a = uPhase + uOmega * delta;
      float f = delta - dot(uObsBeta, pathPos(a, position) - uObs) / uC;
      if (f > 0.0) hi = delta; else lo = delta;
      float next = delta - f / (1.0 - dot(uObsBeta, pathVel(a, position)) / uC);
      delta = next >= lo && next <= hi ? next : 0.5 * (lo + hi);
    }
  }
  float a = uPhase + uOmega * delta;
  vec3 wp = pathPos(a, position);
  vec2 sc = sinCos(a);
  vec3 radial = vec3(sc.y, 0.0, sc.x);
  vec3 forward = vec3(-sc.x, 0.0, sc.y) * sign(uOmega);
  vNormal = normalize(forward * normal.x + vec3(0.0, normal.y, 0.0) + radial * normal.z);
  vec3 k = normalize(uObs - wp);
  vDsrc = 1.0 / (uGamma * (1.0 - dot(forward * uBeta, k)));
  vVelocity = forward * uBeta;
  vDin = uGamma * (1.0 + dot(vVelocity, uSun));
  vSunLocal = uAberrationOn > 0.5 ? observerToWorld(uSun, -vVelocity) : uSun;
  vTau = uTauNow + delta / uGamma;
  vWorld = wp;
  vColor = aColor;
  vPattern = aPattern;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
#ifdef PROOF
  // proofs.ts reads the solve back: each vertex becomes a point on its own pixel.
  gl_Position = vec4(aReadout, 0.0, 1.0);
  gl_PointSize = 1.0;
#endif
}
