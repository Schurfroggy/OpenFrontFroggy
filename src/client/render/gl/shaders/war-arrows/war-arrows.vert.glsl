#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aShape;
layout(location=2) in vec3 aColor;
layout(location=3) in vec3 aLife;
layout(location=4) in vec4 aHead;
uniform mat3 uCamera;
out vec4 vShape;
flat out vec4 vHead;
flat out vec3 vColor;
flat out vec3 vLife;
void main() {
  vShape = aShape;
  vHead = aHead;
  vColor = aColor;
  vLife = aLife;
  gl_Position = vec4((uCamera * vec3(aPos + 0.5, 1.0)).xy, 0.0, 1.0);
}
