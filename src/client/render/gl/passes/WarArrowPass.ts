/**
 * WarArrowPass — history-book style curved war arrows.
 *
 * One arrow per active attack front: a cubic Bezier ribbon from the
 * attacker's side of the front to the defender's side, colored by the
 * attacker's palette with a soft white outline, tipped with a triangular
 * arrowhead along the end tangent. Retreating attacks blink.
 *
 * All sizes are in WORLD TILES so arrows scale with the map/territories
 * (zoom just magnifies them like everything else). The CPU samples each
 * Bezier into a polyline strip once per update; the shaders only transform
 * and shade. Arrow counts are small (tens), so CPU tessellation is cheap.
 */

import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/war-arrows/war-arrows.frag.glsl?raw";
import vertSrc from "../shaders/war-arrows/war-arrows.vert.glsl?raw";

/** Per-instance input: one curved arrow. */
export interface WarArrow {
  /** Cubic Bezier control points, world tiles. */
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

/** Samples along each Bezier (segments = samples - 1). */
const CURVE_SAMPLES = 24;

// Interleaved vertex layout: pos.xy, attr(x=side,y=isHead,z=localY,w=blink), rgb, fade
const FLOATS_PER_VERTEX = 10;

export class WarArrowPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;

  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;
  private uBlinkPeriod: WebGLUniformLocation;

  private visible = false;
  private arrows: WarArrow[] = [];
  private vertexData = new Float32Array(0);
  private indexData = new Uint16Array(0);
  private indexCount = 0;

  private readonly cfg: RenderSettings["warArrows"];

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.cfg = settings.warArrows;
    this.program = createProgram(gl, vertSrc, fragSrc);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uAlpha = gl.getUniformLocation(this.program, "uAlpha")!;
    this.uBlinkPeriod = gl.getUniformLocation(this.program, "uBlinkPeriod")!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0); // aPos
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); // aAttr
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 2 * 4);
    gl.enableVertexAttribArray(2); // aColor
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(3); // aFade
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 9 * 4);

    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);

    gl.bindVertexArray(null);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  /** Push the current set of war arrows (replaces the previous set). */
  updateArrows(arrows: WarArrow[]): void {
    this.arrows = arrows;
    this.tessellate();
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (!this.visible || this.indexCount === 0) return;
    void zoom;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTime, performance.now());
    gl.uniform1f(this.uAlpha, this.cfg.alpha);
    gl.uniform1f(this.uBlinkPeriod, this.cfg.blinkPeriodMs);

    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------- tessellation

  private bezier(
    a: WarArrow,
    t: number,
    out: { x: number; y: number },
  ): void {
    const it = 1 - t;
    const it2 = it * it;
    const it3 = it2 * it;
    const t2 = t * t;
    const t3 = t2 * t;
    out.x =
      it3 * a.p0x +
      3 * it2 * t * a.p1x +
      3 * it * t2 * a.p2x +
      t3 * a.p3x;
    out.y =
      it3 * a.p0y +
      3 * it2 * t * a.p1y +
      3 * it * t2 * a.p2y +
      t3 * a.p3y;
  }

  /**
   * Rebuild the shared vertex/index buffers from `arrows`. Sizes are world
   * tiles, so this only needs to run when the arrow set itself changes.
   *
   * Each arrow contributes:
   *  - a ribbon strip: CURVE_SAMPLES segments, outer (white outline) and
   *    inner (color fill) strips laid over each other,
   *  - one arrowhead quad at the end tangent (single quad; the fragment
   *    shader draws the triangle plus a soft outline that fades out along
   *    the base edge so the head blends into the ribbon).
   */
  private tessellate(): void {
    if (this.arrows.length === 0) {
      this.indexCount = 0;
      return;
    }

    const maxVerts = this.arrows.length * (CURVE_SAMPLES * 4 + 4);
    const ribbonIndices = (CURVE_SAMPLES - 1) * 6;
    const maxIndices = this.arrows.length * (ribbonIndices * 2 + 6);
    if (this.vertexData.length < maxVerts * FLOATS_PER_VERTEX) {
      this.vertexData = new Float32Array(maxVerts * FLOATS_PER_VERTEX);
    }
    if (this.indexData.length < maxIndices) {
      this.indexData = new Uint16Array(maxIndices);
    }

    const V = this.vertexData;
    const I = this.indexData;
    let vi = 0;
    let ii = 0;
    const p = { x: 0, y: 0 };

    const pushVert = (
      x: number,
      y: number,
      side: number,
      isHead: number,
      localY: number,
      blink: number,
      r: number,
      g: number,
      b: number,
      fade: number,
    ): number => {
      const o = vi * FLOATS_PER_VERTEX;
      V[o] = x;
      V[o + 1] = y;
      V[o + 2] = side;
      V[o + 3] = isHead;
      V[o + 4] = localY;
      V[o + 5] = blink;
      V[o + 6] = r;
      V[o + 7] = g;
      V[o + 8] = b;
      V[o + 9] = fade;
      return vi++;
    };

    for (const a of this.arrows) {
      const blink = a.retreating ? 1 : 0;
      const fade = a.fade;
      // All thicknesses scale with the warring nations' territory size.
      const scale = a.scale;
      const widthStart = this.cfg.widthStartTiles * scale;
      const widthTip = this.cfg.widthTipTiles * scale;
      const outline = this.cfg.outlineTiles * scale;
      const headWidth = this.cfg.headWidthTiles * scale;
      const headLen = this.cfg.headLenTiles * scale;

      // Sample the curve once.
      const xs = new Float32Array(CURVE_SAMPLES);
      const ys = new Float32Array(CURVE_SAMPLES);
      for (let s = 0; s < CURVE_SAMPLES; s++) {
        const t = s / (CURVE_SAMPLES - 1);
        this.bezier(a, t, p);
        xs[s] = p.x;
        ys[s] = p.y;
      }

      // Ribbon: outline strip (white, wider) then fill strip (color).
      // The strip stops where the arrowhead's base sits (one head-length
      // back along the curve from the end) so it tucks fully under the
      // triangle — with the apex anchored at p3, a ribbon running all the
      // way to p3 would poke a thin spike past the triangle's slanted
      // edges.
      let ribbonSamples = CURVE_SAMPLES;
      {
        // Walk samples backward from the end until we've covered a head
        // length; that sample is the head base position.
        let dist = 0;
        for (let s = CURVE_SAMPLES - 1; s > 0; s--) {
          dist += Math.hypot(xs[s] - xs[s - 1], ys[s] - ys[s - 1]);
          if (dist >= headLen) {
            ribbonSamples = s + 1; // include the base sample itself
            break;
          }
        }
        // Always keep at least two samples so the strip has a segment.
        ribbonSamples = Math.max(2, ribbonSamples);
      }
      for (const strip of [0, 1] as const) {
        const isOutline = strip === 0;
        const baseIdx = vi;
        for (let s = 0; s < ribbonSamples; s++) {
          const t = s / (CURVE_SAMPLES - 1);
          const sPrev = Math.max(0, s - 1);
          const sNext = Math.min(CURVE_SAMPLES - 1, s + 1);
          let tx = xs[sNext] - xs[sPrev];
          let ty = ys[sNext] - ys[sPrev];
          const tl = Math.hypot(tx, ty);
          if (tl < 1e-6) {
            tx = 1;
            ty = 0;
          } else {
            tx /= tl;
            ty /= tl;
          }
          const nx = -ty;
          const ny = tx;
          const taper = widthStart + (widthTip - widthStart) * t;
          const half = isOutline ? taper + outline : taper;
          const cx = xs[s];
          const cy = ys[s];
          const cr = isOutline ? 1 : a.r;
          const cg = isOutline ? 1 : a.g;
          const cb = isOutline ? 1 : a.b;
          pushVert(cx + nx * half, cy + ny * half, 1, 0, 0, blink, cr, cg, cb, fade);
          pushVert(cx - nx * half, cy - ny * half, -1, 0, 0, blink, cr, cg, cb, fade);
        }
        for (let s = 0; s < ribbonSamples - 1; s++) {
          const v0 = baseIdx + s * 2;
          I[ii++] = v0;
          I[ii++] = v0 + 1;
          I[ii++] = v0 + 2;
          I[ii++] = v0 + 1;
          I[ii++] = v0 + 3;
          I[ii++] = v0 + 2;
        }
      }

      // Arrowhead: single quad along the end tangent, apex exactly on the
      // curve end (p3). The fragment shader renders the triangle with a
      // soft outline that fades along the base edge (v = -1) so the head
      // melts into the ribbon tip instead of showing a hard border line.
      const ex = xs[CURVE_SAMPLES - 1];
      const ey = ys[CURVE_SAMPLES - 1];
      let tx = ex - xs[CURVE_SAMPLES - 2];
      let ty = ey - ys[CURVE_SAMPLES - 2];
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-6) {
        tx = 1;
        ty = 0;
      } else {
        tx /= tl;
        ty /= tl;
      }
      const nx = -ty;
      const ny = tx;
      const halfW = headWidth;
      const len = headLen;
      // The triangle's APEX sits exactly on the curve end (p3): the quad
      // runs backward from there (base at v=-1, len behind), overlapping
      // the ribbon tip. The tip therefore never reaches beyond p3, so the
      // controller's tip-extent measure fully bounds the head.
      const baseIdx = vi;
      const corners: [number, number][] = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      for (const [u, v] of corners) {
        // v=+1 (apex) at the curve end; v=-1 (base) one head-length behind.
        const wx = ex + tx * ((v - 1) * len * 0.5) + nx * (u * halfW);
        const wy = ey + ty * ((v - 1) * len * 0.5) + ny * (u * halfW);
        pushVert(wx, wy, u, 1, v, blink, a.r, a.g, a.b, fade);
      }
      I[ii++] = baseIdx;
      I[ii++] = baseIdx + 1;
      I[ii++] = baseIdx + 2;
      I[ii++] = baseIdx;
      I[ii++] = baseIdx + 2;
      I[ii++] = baseIdx + 3;
    }

    this.indexCount = ii;

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      V.subarray(0, vi * FLOATS_PER_VERTEX),
      gl.DYNAMIC_DRAW,
    );
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      I.subarray(0, ii),
      gl.DYNAMIC_DRAW,
    );
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
