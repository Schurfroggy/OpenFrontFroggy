#version 300 es
precision highp float;

// Curved war arrow — history-book style bezier ribbon with arrowhead.
//
// The CPU pre-samples each arrow's cubic Bezier into a strip (constant
// screen-space width, tapering near the tip) plus an arrowhead quad at the
// end tangent. Vertices carry world position + local attributes + color;
// this shader only transforms.

layout(location = 0) in vec2 aPos;   // world tile position (center of tile)
layout(location = 1) in vec4 aAttr;  // x: side [-1,1], y: isHead, z: localY, w: blink

uniform mat3 uCamera;

out vec2 vSide;   // x: across-strip/local-x [-1,1]
out float vLocalY;
flat out vec3 vColor;
flat out float vHead;
flat out float vBlink;
flat out float vFade;

// Per-draw color+blink would be simpler, but arrows of many players share
// the buffer; carry them per-vertex instead.
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aFade; // opacity multiplier (war went quiet)

void main() {
  vSide = vec2(aAttr.x, 0.0);
  vLocalY = aAttr.z;
  vHead = aAttr.y;
  vBlink = aAttr.w;
  vColor = aColor;
  vFade = aFade;
  vec3 clip = uCamera * vec3(aPos + 0.5, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
