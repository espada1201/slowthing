attribute vec3 aColor;
attribute float aPattern;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vPattern;

void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColor = aColor;
  vPattern = aPattern;
  gl_Position = projectionMatrix * viewMatrix * w;
}
