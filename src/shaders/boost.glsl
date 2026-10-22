// Aberration. Light that an observer moving with velocity beta (in units of c) sees arriving along n comes, in the
// scenery's frame, from observerToWorld(n, beta); the reverse, where something moving at beta sees light that lies
// along n in the scenery, is observerToWorld(n, -beta).
vec3 observerToWorld(vec3 n, vec3 beta) {
  float b = length(beta);
  if (b < 1e-6) return n;
  vec3 bh = beta / b;
  float g = 1.0 / sqrt(1.0 - b * b);
  float par = dot(n, bh);
  vec3 perp = n - bh * par;
  float den = 1.0 - dot(beta, n);
  return normalize(bh * (par - b) / den + perp / (g * den));
}
