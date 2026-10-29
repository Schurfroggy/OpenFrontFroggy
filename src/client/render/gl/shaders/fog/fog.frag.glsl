#version 300 es
precision highp float;
in vec2 vWorldPos;
uniform sampler2D uBrightness;
uniform sampler2D uPreviousBrightness;
uniform float uBlend;
uniform float uExponent;
uniform float uAmbientBrightness;
uniform vec3 uColor;
uniform sampler2D uCloudNoise;
uniform vec3 uCloudColor;
uniform float uCloudStrength;
uniform float uCloudScale;
uniform float uTime;
out vec4 fragColor;

// Four bilinear samples soften the discrete simulation levels in one pass.
float smoothLight(sampler2D field, vec2 uv, vec2 texel) {
  vec2 d = texel * 1.25;
  return (texture(field, uv + vec2(-d.x, -d.y)).r
        + texture(field, uv + vec2( d.x, -d.y)).r
        + texture(field, uv + vec2(-d.x,  d.y)).r
        + texture(field, uv + vec2( d.x,  d.y)).r) * (255.0 / 64.0);
}

void main() {
  // Map-anchored layers drift independently; neither noise nor time changes visibility.
  // A larger repeat period plus independent warped layers hides tiling at overview zoom.
  vec2 cloudUV = vWorldPos / (max(uCloudScale, 1.0) * 4.0);
  vec2 warpUV = mat2(0.6, -0.8, 0.8, 0.6) * cloudUV * 0.73;
  vec2 warp = texture(uCloudNoise, warpUV + vec2(0.19, 0.53)
                       + uTime * vec2(0.00012, -0.00009)).rg - 0.5;
  float broad = texture(uCloudNoise, cloudUV + warp * 0.12
                        + uTime * vec2(0.0003, 0.0001125)).r;
  vec2 detailUV = mat2(0.8, 0.6, -0.6, 0.8) * cloudUV * 2.03;
  float detail = texture(uCloudNoise, detailUV - warp * 0.08 + vec2(0.37, 0.61)
                         + uTime * vec2(-0.00015, 0.000225)).g;
  float cloud = smoothstep(0.22, 0.78, broad * 0.65 + detail * 0.35);
  vec3 fogColor = mix(uColor, uCloudColor, cloud * uCloudStrength);
  ivec2 size = textureSize(uBrightness, 0);
  ivec2 tile = clamp(ivec2(floor(vWorldPos)), ivec2(0), size - 1);
  // Visibility revocation is immediate. Filtering/animation never reveals hidden tiles.
  bool unobserved = texelFetch(uBrightness, tile, 0).r == 0.0;
  if (unobserved && uAmbientBrightness == 0.0) {
    fragColor = vec4(fogColor, 1.0);
    return;
  }
  vec2 texel = 1.0 / vec2(size);
  vec2 uv = vWorldPos * texel;
  float light = mix(smoothLight(uPreviousBrightness, uv, texel),
                    smoothLight(uBrightness, uv, texel), uBlend);
  // Never let interpolation keep revoked local sight alive. Background light
  // shows terrain only; the simulation mask still gates all units and inputs.
  light = max(unobserved ? 0.0 : clamp(light, 0.0, 1.0), uAmbientBrightness);
  float visible = pow(light, uExponent) * smoothstep(0.0, 1.5 / 16.0, light);
  fragColor = vec4(fogColor, 1.0 - visible);
}
