#version 300 es
precision highp float;
in vec4 vShape;
flat in vec4 vHead;
flat in vec3 vColor;
flat in vec3 vLife;
uniform float uTime;
uniform float uOutline;
uniform float uAlpha;
uniform vec2 uOpacityGradient; // tail, head opacity multipliers
uniform float uBlinkPeriod;
uniform float uTailNotchRatio;
out vec4 fragColor;
// V-notched tail, tapered shaft and swept head share one concave outline.
// Only exterior edges are shaded: the shaft/head connection has no seam.
float arrowDistance(vec2 p, out float outlineDistance) {
  float arrowLength = vShape.z, tail = vShape.w;
  float shoulder = vHead.x, notch = vHead.y, headWidth = vHead.z, neckWidth = vHead.w;
  float join = notch - (notch-shoulder)*neckWidth/max(headWidth,0.001);
  float tailNotch = min(tail * max(0.0, uTailNotchRatio), max(0.0, join * 0.5));
  vec2 points[8] = vec2[8](
    vec2(0.0,-tail), vec2(join,-neckWidth), vec2(shoulder,-headWidth),
    vec2(arrowLength,0.0), vec2(shoulder,headWidth), vec2(join,neckWidth),
    vec2(0.0,tail), vec2(tailNotch,0.0));
  float distanceSquared = 1e20;
  float outlineDistanceSquared = 1e20;
  bool inside = false;
  for (int i=0, j=7; i<8; j=i, i++) {
    vec2 start = points[j], end = points[i];
    vec2 edge = end-start;
    vec2 offset = p-start;
    vec2 nearest = offset-edge*clamp(dot(offset,edge)/max(dot(edge,edge),1e-8),0.0,1.0);
    float edgeDistanceSquared = dot(nearest,nearest);
    distanceSquared = min(distanceSquared,edgeDistanceSquared);
    // The two V-cut edges define coverage but have no white outline.
    if (i > 0 && i < 7) {
      outlineDistanceSquared = min(outlineDistanceSquared,edgeDistanceSquared);
    }
    if ((start.y>p.y)!=(end.y>p.y)) {
      if (p.x < start.x+(end.x-start.x)*(p.y-start.y)/(end.y-start.y)) inside = !inside;
    }
  }
  outlineDistance = sqrt(outlineDistanceSquared);
  return (inside ? -1.0 : 1.0)*sqrt(distanceSquared);
}
void main() {
  vec2 p = vShape.xy;
  float arrowLength = vShape.z;
  float outlineDistance;
  float distanceToEdge = -arrowDistance(p, outlineDistance);
  float aa = max(fwidth(distanceToEdge), 0.001);
  float coverage = smoothstep(0.0, aa, distanceToEdge);
  float border = 1.0 - smoothstep(uOutline, uOutline + aa, outlineDistance);
  float along = p.x / max(arrowLength, 0.001);
  // Keep the head solid while the body smoothly recedes toward the tail.
  // Applied to both fill and outline, independently of the reveal animation.
  float gradient = mix(uOpacityGradient.x, uOpacityGradient.y, smoothstep(0.0, 0.8, along));
  float reveal = 1.0 - smoothstep(vLife.y * 1.12 - 0.12, vLife.y * 1.12, along);
  float retreat = mix(1.0, 0.7 + 0.3 * sin(uTime * 6.2831853 / max(uBlinkPeriod, 1.0)), vLife.z);
  vec3 color = mix(vColor, vec3(0.95, 0.98, 1.0), border * 0.8);
  fragColor = vec4(color, coverage * gradient * reveal * vLife.x * uAlpha * retreat);
}
