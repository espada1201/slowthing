// What a moving observer actually sees: aberrate each screen ray into the scenery frame (boost.glsl), look it up in
// the rest-frame cube map, then apply the Doppler colour shift and D⁵ searchlight beaming.
// The cube map's alpha multiplies the observer's Doppler factor D_obs. Everything at rest in the scenery writes 1, so
// its light is shifted by D_obs here. Moving objects are shaded all the way to the eye (slow-moving.frag) and write
// 1 / D_obs, so here their light is shifted no further.
uniform samplerCube uCube;
uniform vec3 uBeta;
uniform mat3 uCamRot;
uniform vec2 uTan;
uniform float uAberration;
uniform float uDoppler;
uniform float uBeaming;
uniform float uExposure;
varying vec2 vUv;

void main() {
  vec3 nObs = normalize(uCamRot * vec3((vUv.x * 2.0 - 1.0) * uTan.x, (vUv.y * 2.0 - 1.0) * uTan.y, -1.0));
  vec3 nW = uAberration > 0.5 ? observerToWorld(nObs, uBeta) : nObs;
  vec4 s = texture(uCube, nW);
  float D = dopplerFactor(nW, uBeta) * s.a;
  vec3 col = uDoppler > 0.5 ? dopplerShift(s.rgb, D, 1.0) : s.rgb;
  if (uBeaming > 0.5) col *= pow(D, 5.0);
  col *= uExposure;
  gl_FragColor = vec4(linearToSRGB(softClip(col)), 1.0);
}
