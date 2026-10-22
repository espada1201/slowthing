// One half of a Visscher leapfrog step for the courtyard wave (mirrors physics/schrodinger.ts, stencil 4).
// State texel: r = Re ψ(t), g = Im ψ(t+½), b = Im ψ(t−½), a = probability absorbed here so far.
// Potential texel: r = V (J), g = 1 if open floor / 0 inside a wall, b = sponge damping rate (1/s).
uniform sampler2D uState;
uniform sampler2D uPot;
uniform int uN;
uniform int uPass;
uniform float uKin;  // ħ²/(2m dx²) / 12
uniform float uDtH;  // Δt / ħ
uniform float uDt;
uniform float uCell; // dx²

vec4 at(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uN || p.y >= uN) return vec4(0.0);
  return texelFetch(uState, p, 0);
}

// 12 dx² ∇² of the channel picked by mask: 16 Σ nearest − Σ next-nearest − 60 centre.
float lap(ivec2 p, vec4 mask, float c) {
  vec4 near = at(p + ivec2(1, 0)) + at(p - ivec2(1, 0)) + at(p + ivec2(0, 1)) + at(p - ivec2(0, 1));
  vec4 far = at(p + ivec2(2, 0)) + at(p - ivec2(2, 0)) + at(p + ivec2(0, 2)) + at(p - ivec2(0, 2));
  return 16.0 * dot(mask, near) - dot(mask, far) - 60.0 * c;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  vec4 pot = texelFetch(uPot, p, 0);
  if (uPass == 0) {
    s.r += uDtH * (-uKin * lap(p, vec4(0.0, 1.0, 0.0, 0.0), s.g) + pot.r * s.g) * pot.g;
  } else {
    float h = (-uKin * lap(p, vec4(1.0, 0.0, 0.0, 0.0), s.r) + pot.r * s.r) * pot.g;
    s.b = s.g;
    s.g -= uDtH * h;
    // Absorbing edges: damp the amplitude and bank the probability removed, for the detectors.
    float f = exp(-pot.b * uDt);
    float rho = max(s.r * s.r + s.g * s.b, 0.0);
    s.rgb *= f;
    s.a += rho * (1.0 - f * f) * uCell;
  }
  gl_FragColor = s;
}
