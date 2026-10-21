import { afterEach, describe, expect, it, vi } from "vitest";
import { FogOfWarPass } from "../../../src/client/render/gl/passes/FogOfWarPass";

// Exercise real upload/interpolation logic with a recording GL boundary.
function scene() {
  const gl = {
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texSubImage2D: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    useProgram: vi.fn(),
    uniformMatrix3fv: vi.fn(),
    uniform1f: vi.fn(),
    uniform3fv: vi.fn(),
    bindVertexArray: vi.fn(),
    drawArrays: vi.fn(),
  };
  const pass = Object.create(FogOfWarPass.prototype) as FogOfWarPass;
  Object.assign(pass, {
    gl,
    texture: {},
    previousTexture: {},
    initialized: false,
    width: 10,
    height: 10,
    settings: { transitionMs: 100, cloudSpeed: 1 },
    startedAt: 0,
    blend: "blend",
    time: "time",
  });
  return { pass, gl };
}

afterEach(() => vi.restoreAllMocks());

describe("fog texture updates", () => {
  it("skips unchanged uploads and lets interpolation and cloud time advance", () => {
    const { pass, gl } = scene();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const first = new Uint8Array(100).fill(5);
    pass.update(first, 1);
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(100);
    const changed = first.slice();
    changed[5] = 16;
    pass.update(changed, 2);
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(3);
    clock.mockReturnValue(150);
    pass.update(changed, 2);
    pass.draw(new Float32Array(9));
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(3);
    expect(gl.uniform1f).toHaveBeenCalledWith("blend", 0.5);
    expect(gl.uniform1f).toHaveBeenCalledWith("time", 0.15);
    clock.mockReturnValue(200);
    pass.draw(new Float32Array(9));
    expect(gl.uniform1f).toHaveBeenCalledWith("blend", 1);
    expect(gl.uniform1f).toHaveBeenCalledWith("time", 0.2);
  });

  it("reuploads on disable/re-enable, a new view, or a changed version", () => {
    const { pass, gl } = scene();
    const mask = new Uint8Array(100);
    pass.update(mask, 1);
    pass.update(mask, 1);
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(2);
    pass.update(null);
    pass.update(mask, 1);
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(4);
    pass.update(mask.slice(), 1); // Different view can reuse the same version.
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(5);
    pass.update(mask, 2);
    pass.update(mask, 3);
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(7);
  });
});
