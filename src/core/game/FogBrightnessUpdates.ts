/**
 * Output deduplication only: vision is still recomputed every tick. Keep the
 * worker's result separate from the copy whose buffer is transferred/detached.
 */
export class FogBrightnessUpdates {
  private previous: Uint8Array | null | undefined;
  private observer: string | undefined;

  update(
    brightness: Uint8Array | null,
    observer: string | undefined,
  ): Uint8Array | null | undefined {
    if (this.observer === observer && this.equal(brightness)) return undefined;
    this.observer = observer;
    this.previous = brightness;
    return brightness?.slice() ?? null;
  }

  private equal(brightness: Uint8Array | null): boolean {
    if (this.previous === undefined) return false;
    if (brightness === null || this.previous === null)
      return brightness === this.previous;
    if (brightness.length !== this.previous.length) return false;
    for (let i = 0; i < brightness.length; i++)
      if (brightness[i] !== this.previous[i]) return false;
    return true;
  }
}
