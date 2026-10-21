// Objects on circular paths, drawn where they were when the light now reaching the eye left them.
// Solves c·(t − t_r) = |x_obs − x(t_r)| per vertex with Newton's method (see physics/relativity.ts).
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
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vPattern;
varying float vDsrc;
varying float vTau;

vec3 pathPos(float a, vec3 local) {
  vec3 radial = vec3(cos(a), 0.0, sin(a));
  vec3 forward = vec3(-sin(a), 0.0, cos(a)) * sign(uOmega);
  float k = uContract > 0.5 ? 1.0 / uGamma : 1.0;
  return uCenter + uRadius * radial + forward * local.x * k + vec3(0.0, local.y, 0.0) + radial * local.z;
}

void main() {
  float delta = 0.0;
  if (uRetard > 0.5) {
    delta = -length(uObs - pathPos(uPhase, position)) / uC;
    for (int i = 0; i < 8; i++) {
      float a = uPhase + uOmega * delta;
      vec3 d = uObs - pathPos(a, position);
      float dist = max(length(d), 1e-4);
      vec3 vel = vec3(-sin(a), 0.0, cos(a)) * uOmega * uRadius;
      float f = -uC * delta - dist;
      float fp = -uC + dot(d, vel) / dist;
      delta -= f / fp;
    }
  }
  float a = uPhase + uOmega * delta;
  vec3 wp = pathPos(a, position);
  vec3 radial = vec3(cos(a), 0.0, sin(a));
  vec3 forward = vec3(-sin(a), 0.0, cos(a)) * sign(uOmega);
  vNormal = normalize(forward * normal.x + vec3(0.0, normal.y, 0.0) + radial * normal.z);
  vec3 k = normalize(uObs - wp);
  vDsrc = 1.0 / (uGamma * (1.0 - dot(forward * uBeta, k)));
  vTau = uTauNow + delta / uGamma;
  vWorld = wp;
  vColor = aColor;
  vPattern = aPattern;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
