/** Continuous lance arrows, animated by the existing render loop. */
import type { RenderSettings } from "../RenderSettings";
import fragSrc from "../shaders/war-arrows/war-arrows.frag.glsl?raw";
import vertSrc from "../shaders/war-arrows/war-arrows.vert.glsl?raw";
import { createProgram } from "../utils/GlUtils";
import { arrowShape, WarArrowAnimator } from "./WarArrowGeometry";

/** Per-instance input: one straight war arrow. */
export interface WarArrow {
  id?: string;
  reveal?: number;
  isPointValid?: (x: number, y: number) => boolean;
  /** World-tile endpoints; p1/p2 are reserved for future curved paths. */
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
  p3x: number;
  p3y: number;
  /** Attacker color RGB [0-1]. */
  r: number;
  g: number;
  b: number;
  /** True when the attack is retreating (blinking arrow). */
  retreating: boolean;
  /** Size multiplier from the warring nations' territory area (1 = base). */
  scale: number;
  /** Opacity multiplier (0–1): 1 while live, easing to 0 when the war's
   *  attack entries vanish (AI re-investment gap / attack ended). */
  fade: number;
}

export class WarArrowPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private visible = false;
  private animator: WarArrowAnimator;
  private cfg: RenderSettings["warArrows"];
  private camera: WebGLUniformLocation | null;
  private time: WebGLUniformLocation | null;
  private outline: WebGLUniformLocation | null;
  private alpha: WebGLUniformLocation | null;
  private opacityGradient: WebGLUniformLocation | null;
  private blink: WebGLUniformLocation | null;
  private tailNotchRatio: WebGLUniformLocation | null;

  constructor(
    private gl: WebGL2RenderingContext,
    settings: RenderSettings,
  ) {
    this.cfg = settings.warArrows;
    this.animator = new WarArrowAnimator(this.cfg);
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.camera = gl.getUniformLocation(this.program, "uCamera");
    this.time = gl.getUniformLocation(this.program, "uTime");
    this.outline = gl.getUniformLocation(this.program, "uOutline");
    this.alpha = gl.getUniformLocation(this.program, "uAlpha");
    this.opacityGradient = gl.getUniformLocation(
      this.program,
      "uOpacityGradient",
    );
    this.blink = gl.getUniformLocation(this.program, "uBlinkPeriod");
    this.tailNotchRatio = gl.getUniformLocation(
      this.program,
      "uTailNotchRatio",
    );
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    // world position, local x/y/length/tail width, color, life, head dimensions
    for (const [location, size, offset] of [
      [0, 2, 0],
      [1, 4, 2],
      [2, 3, 6],
      [3, 3, 9],
      [4, 4, 12],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 64, offset * 4);
    }
    gl.bindVertexArray(null);
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) this.animator.clear();
  }
  updateArrows(arrows: WarArrow[]) {
    this.animator.update(arrows, performance.now());
  }
  draw(camera: Float32Array, _zoom: number) {
    if (!this.visible) return;
    const now = performance.now();
    const data: number[] = [];
    for (const a of this.animator.frame(now)) {
      const shape = arrowShape(a, this.cfg);
      const { length, tailWidth, shoulder, notch, headWidth, neckWidth } =
        shape;
      if (length < 0.01) continue;
      const ux = (a.p3x - a.p0x) / length,
        uy = (a.p3y - a.p0y) / length;
      const width = Math.max(tailWidth, neckWidth, headWidth);
      const vertex = (x: number, y: number) =>
        data.push(
          a.p0x + ux * x - uy * y,
          a.p0y + uy * x + ux * y,
          x,
          y,
          length,
          tailWidth,
          a.r,
          a.g,
          a.b,
          a.fade,
          a.reveal ?? 1,
          a.retreating ? 1 : 0,
          shoulder,
          notch,
          headWidth,
          neckWidth,
        );
      vertex(0, -width);
      vertex(length, -width);
      vertex(0, width);
      vertex(length, -width);
      vertex(length, width);
      vertex(0, width);
    }

    if (!data.length) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    gl.uniformMatrix3fv(this.camera, false, camera);
    gl.uniform1f(this.time, now);
    gl.uniform1f(this.outline, this.cfg.outlineTiles);
    gl.uniform1f(this.alpha, this.cfg.alpha);
    const headOpacity = Math.max(0, Math.min(1, this.cfg.headOpacity));
    const tailOpacity = Math.max(
      0,
      Math.min(headOpacity, this.cfg.tailOpacity),
    );
    gl.uniform2f(this.opacityGradient, tailOpacity, headOpacity);
    gl.uniform1f(this.blink, this.cfg.blinkPeriodMs);
    gl.uniform1f(this.tailNotchRatio, this.cfg.tailNotchRatio);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 16);
    gl.bindVertexArray(null);
  }
  dispose() {
    this.animator.clear();
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
