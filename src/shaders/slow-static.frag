// Surfaces at rest in the scenery, lit in its frame (slow-surface.glsl prepended).
uniform vec3 uSun;

void main() {
  gl_FragColor = vec4(lightSurface(uSun, 1.0).col, 1.0);
}
