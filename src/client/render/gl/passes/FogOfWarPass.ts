import type { RenderSettings } from "../RenderSettings";
import frag from "../shaders/fog/fog.frag.glsl?raw";
import vert from "../shaders/map-overlay/overlay.vert.glsl?raw";
import {
  createFogCloudNoise,
  FOG_CLOUD_TEXTURE_SIZE,
} from "../utils/FogCloudNoise";
import { createMapQuad, createProgram } from "../utils/GlUtils";

/** World-space mask applied before player-authored nuke aiming guides. */
export class FogOfWarPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private texture: WebGLTexture;
  private previousTexture: WebGLTexture;
  private blend: WebGLUniformLocation;
  private initialized = false;
  private brightness: Uint8Array | null = null;
  private version: number | undefined;
  private updatedAt = 0;
  private camera: WebGLUniformLocation;
  private enabled = false;
  private exponent: WebGLUniformLocation;
  private color: WebGLUniformLocation;
  private cloudTexture: WebGLTexture;
  private cloudColor: WebGLUniformLocation;
  private cloudStrength: WebGLUniformLocation;
  private cloudScale: WebGLUniformLocation;
  private time: WebGLUniformLocation;
  private readonly startedAt = performance.now();

  constructor(
    private gl: WebGL2RenderingContext,
    private width: number,
    private height: number,
    private settings: RenderSettings["fogOfWar"],
  ) {
    this.program = createProgram(gl, vert, frag);
    this.vao = createMapQuad(gl, width, height);
    this.camera = gl.getUniformLocation(this.program, "uCamera")!;
    this.exponent = gl.getUniformLocation(this.program, "uExponent")!;
    this.color = gl.getUniformLocation(this.program, "uColor")!;
    this.blend = gl.getUniformLocation(this.program, "uBlend")!;
    this.cloudColor = gl.getUniformLocation(this.program, "uCloudColor")!;
    this.cloudStrength = gl.getUniformLocation(this.program, "uCloudStrength")!;
    this.cloudScale = gl.getUniformLocation(this.program, "uCloudScale")!;
    this.time = gl.getUniformLocation(this.program, "uTime")!;
    this.texture = this.createTexture();
    this.previousTexture = this.createTexture();
    this.cloudTexture = this.createCloudTexture();
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uBrightness"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPreviousBrightness"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uCloudNoise"), 2);
  }

  private createCloudTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const size = FOG_CLOUD_TEXTURE_SIZE;
    gl.texStorage2D(gl.TEXTURE_2D, 9, gl.RG8, size, size);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      size,
      size,
      gl.RG,
      gl.UNSIGNED_BYTE,
      createFogCloudNoise(),
    );
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, this.width, this.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  update(brightness: Uint8Array | null, version?: number): void {
    this.enabled = brightness !== null;
    if (!brightness) {
      this.initialized = false;
      this.brightness = null;
      this.version = undefined;
      return;
    }
    // Unchanged worker updates retain the immutable mask and its version. Do
    // not swap textures or restart interpolation; cloud time advances in draw().
    // Compare identity too: a different GameView may restart its version count.
    if (
      this.initialized &&
      brightness === this.brightness &&
      version === this.version
    )
      return;
    this.brightness = brightness;
    this.version = version;
    const old = this.previousTexture;
    this.previousTexture = this.texture;
    this.texture = old;
    this.upload(this.texture, brightness);
    if (!this.initialized) this.upload(this.previousTexture, brightness);
    this.updatedAt =
      performance.now() - (this.initialized ? 0 : this.settings.transitionMs);
    this.initialized = true;
  }

  private upload(texture: WebGLTexture, brightness: Uint8Array): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.width,
      this.height,
      gl.RED,
      gl.UNSIGNED_BYTE,
      brightness,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  draw(camera: Float32Array): void {
    if (!this.enabled) return;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.camera, false, camera);
    gl.uniform1f(
      this.blend,
      this.settings.transitionMs > 0
        ? Math.min(
            1,
            (performance.now() - this.updatedAt) / this.settings.transitionMs,
          )
        : 1,
    );
    gl.uniform1f(this.exponent, this.settings.brightnessExponent);
    gl.uniform3fv(this.color, this.settings.color);
    gl.uniform3fv(this.cloudColor, this.settings.cloudColor);
    gl.uniform1f(this.cloudStrength, this.settings.cloudStrength);
    gl.uniform1f(this.cloudScale, this.settings.cloudScale);
    gl.uniform1f(
      this.time,
      ((performance.now() - this.startedAt) / 1000) * this.settings.cloudSpeed,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.previousTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTexture);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteTexture(this.previousTexture);
    this.gl.deleteTexture(this.cloudTexture);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
