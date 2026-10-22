// Objects on circular paths, drawn where they were when the light now reaching the eye left them.
// Solves c·(t − t_r) = |x_obs − x(t_r)| per vertex by Newton's method kept inside a bracket around the
// root (as physics/relativity.ts does): unguarded, Newton overshoots and cycles for a fast object seen from afar.
attribute vec3 aColor;
attribute float aPattern;
uniform vec3 uObs;
uniform float uC;
uniform float uPhase;     // path angle at the observer's current world time
uniform float uOmega;     // angular speed, rad/s (sign = direction)
uniform float uRadius;
uniform vec3 uCenter;
uniform float uGamma;     // Lorentz factor of the object's speed
uniform float uBeta;      // object's speed / c
uniform float uRetard;    // 1 = finite light speed, 0 = instantaneous
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

// Where something moving with velocity β sees a source that lies along n in the town (aberration).
vec3 aberrate(vec3 n, vec3 beta) {
  float b = length(beta);
  if (b < 1e-6) return n;
  vec3 bh = beta / b;
  float par = dot(n, bh);
  float den = 1.0 + dot(beta, n);
  return normalize(bh * (par + b) / den + (n - bh * par) * sqrt(1.0 - b * b) / den);
}

vec3 pathPos(float a, vec3 local) {
  vec3 radial = vec3(cos(a), 0.0, sin(a));
  vec3 forward = vec3(-sin(a), 0.0, cos(a)) * sign(uOmega);
  float k = uContract > 0.5 ? 1.0 / uGamma : 1.0;
  return uCenter + uRadius * radial + forward * local.x * k + vec3(0.0, local.y, 0.0) + radial * local.z;
}

// That point's velocity, d pathPos / dt: the object turns as it goes round, so its outer and leading
// points move faster than the track's centre line.
vec3 pathVel(float a, vec3 local) {
  vec3 radial = vec3(cos(a), 0.0, sin(a));
  vec3 forward = vec3(-sin(a), 0.0, cos(a)) * sign(uOmega);
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
  }
  float a = uPhase + uOmega * delta;
  vec3 wp = pathPos(a, position);
  vec3 radial = vec3(cos(a), 0.0, sin(a));
  vec3 forward = vec3(-sin(a), 0.0, cos(a)) * sign(uOmega);
  vNormal = normalize(forward * normal.x + vec3(0.0, normal.y, 0.0) + radial * normal.z);
  vec3 k = normalize(uObs - wp);
  vDsrc = 1.0 / (uGamma * (1.0 - dot(forward * uBeta, k)));
  vVelocity = forward * uBeta;
  vDin = uGamma * (1.0 + dot(vVelocity, uSun));
  vSunLocal = uAberrationOn > 0.5 ? aberrate(uSun, vVelocity) : uSun;
  vTau = uTauNow + delta / uGamma;
  vWorld = wp;
  vColor = aColor;
  vPattern = aPattern;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
