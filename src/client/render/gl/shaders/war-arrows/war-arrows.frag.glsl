#version 300 es
precision highp float;

in vec2 vSide;
in float vLocalY;
flat in vec3 vColor;
flat in float vHead;
flat in float vBlink;
flat in float vFade;

uniform float uTime;        // wall-clock ms
uniform float uAlpha;       // base opacity
uniform float uBlinkPeriod; // retreat blink period, ms

out vec4 fragColor;

void main() {
  float alpha = uAlpha;
  // Retreating attacks blink so they read as "pulling back".
  if (vBlink > 0.5) {
    alpha *= 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 6.2831853 / uBlinkPeriod));
  }

  float fill;
  vec3 col = vColor;
  if (vHead > 0.5) {
    // Arrowhead quad local space: vSide.x = u in [-1,1] across,
    // vLocalY = v in [-1,1] along the flight direction (+1 = apex).
    // Triangle: |u| + (v + 1) / 2 <= 1  (apex at v=+1, base at v=-1).
    float dTri = abs(vSide.x) + (vLocalY + 1.0) * 0.5 - 1.0;

    // Triangle fill.
    fill = 1.0 - smoothstep(-0.02, 0.02, dTri);

    // Soft white outline band just outside the triangle's two slanted
    // edges. It fades out near the base edge (v close to -1) so the head
    // blends into the ribbon instead of a hard border across its base.
    float outlineW = 0.10; // band width in local units
    float band = 1.0 - smoothstep(0.0, outlineW, dTri);
    float baseFade = smoothstep(-1.0, -0.35, vLocalY); // 0 at base → 1
    float isEdge = clamp(band - fill, 0.0, 1.0) * baseFade;

    col = mix(vColor, vec3(1.0), isEdge);
    fill = max(fill, isEdge);
  } else {
    // Ribbon: across-strip [-1,+1] with a soft AA edge.
    fill = 1.0 - smoothstep(0.85, 1.0, abs(vSide.x));
  }

  if (fill < 0.01) discard;
  fragColor = vec4(col, fill * alpha * vFade);
}
