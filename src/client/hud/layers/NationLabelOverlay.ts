import { html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { Cell } from "../../../core/game/Game";
import {
  NATION_NAMES_EVENT,
  setMapLabelOverlayActive,
  translatedPlaceName,
} from "../../NationNames";
import type { TransformHandler } from "../../TransformHandler";
import type { GameView } from "../../view/GameView";

/** nameData.size is in world cells; the camera scale converts to pixels. Tune
 * here if the DOM label looks larger or smaller than the renderer's own text. */
const FONT_SCALE = 1;

const LABEL_STYLE = [
  "position:fixed",
  "left:0",
  "top:0",
  "z-index:5",
  "pointer-events:none",
  "color:#fff",
  "font-weight:700",
  "line-height:1",
  "white-space:nowrap",
  "user-select:none",
  "text-shadow:0 0 2px rgba(0,0,0,.9),0 0 4px rgba(0,0,0,.75),0 1px 2px rgba(0,0,0,.9)",
].join(";");

/**
 * Draws the Chinese place names that sit inside territories.
 *
 * The renderer's own name pass draws text from a pre-baked MSDF glyph atlas
 * covering Latin only (char codes 0..383), so a Chinese label there renders as
 * garbage. Those players' GL names are blanked (PlayerView.mapLabelName) and
 * re-drawn here as plain DOM text, which the browser can shape with any font.
 *
 * Only players with a translation are drawn — everything else keeps the
 * renderer's own label, so this overlay is inert until the 国名汉化 option is on.
 */
@customElement("nation-label-overlay")
export class NationLabelOverlay extends LitElement {
  createRenderRoot() {
    return this;
  }

  private gameView: GameView | null = null;
  private transformHandler: TransformHandler | null = null;
  private nodes = new Map<string, HTMLDivElement>();
  private loop = 0;
  private frame = 0;

  public set game(value: GameView | null) {
    this.gameView = value;
    this.syncLoop();
  }

  public set transform(value: TransformHandler | null) {
    this.transformHandler = value;
    this.syncLoop();
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(NATION_NAMES_EVENT, this.onOptionChanged);
    this.syncLoop();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(NATION_NAMES_EVENT, this.onOptionChanged);
    setMapLabelOverlayActive(false);
    this.stopLoop();
    this.clear();
  }

  /** The option flipped: repaint immediately instead of waiting a frame. */
  private onOptionChanged = () => {
    this.syncLoop();
    this.paint();
  };

  private syncLoop(): void {
    const ready =
      this.isConnected &&
      this.gameView !== null &&
      this.transformHandler !== null;
    if (ready && this.loop === 0) {
      setMapLabelOverlayActive(true);
      this.loop = requestAnimationFrame(this.tick);
    } else if (!ready) {
      setMapLabelOverlayActive(false);
      this.stopLoop();
      this.clear();
    }
  }

  private stopLoop(): void {
    if (this.loop !== 0) cancelAnimationFrame(this.loop);
    this.loop = 0;
  }

  private tick = () => {
    this.loop = requestAnimationFrame(this.tick);
    // Labels only move when the camera does, and halving the rate costs
    // nothing visible at this size.
    if ((this.frame++ & 1) === 1) return;
    this.paint();
  };

  private paint(): void {
    const game = this.gameView;
    const transform = this.transformHandler;
    if (game === null || transform === null) return;

    const seen = new Set<string>();
    const scale = transform.scale;

    for (const player of game.players()) {
      if (!player.isAlive()) continue;
      const translated = translatedPlaceName(
        player.static.displayName,
        player.nationFlag,
      );
      if (translated === null) continue;
      const data = player.nameData;
      if (data === undefined || data.size <= 0) continue;

      const screen = transform.worldToScreenCoordinates(
        new Cell(data.x, data.y),
      );
      const fontSize = data.size * scale * FONT_SCALE;
      // Below this the label is unreadable anyway; the renderer hides its own
      // text at a similar point.
      if (fontSize < 7) continue;
      if (
        screen.x < -200 ||
        screen.y < -200 ||
        screen.x > window.innerWidth + 200 ||
        screen.y > window.innerHeight + 200
      ) {
        continue;
      }

      seen.add(player.id());
      const el = this.ensureNode(player.id());
      if (el.textContent !== translated) el.textContent = translated;
      el.style.fontSize = `${fontSize}px`;
      // -50% centering plus a half-line lift: the renderer's name sits above
      // the troop count line, which stays on the GL path.
      el.style.transform = `translate(-50%, -50%) translate(${screen.x}px, ${screen.y - fontSize * 0.6}px)`;
      el.style.display = "";
    }

    for (const [id, el] of this.nodes) {
      if (!seen.has(id)) el.style.display = "none";
    }
  }

  private ensureNode(id: string): HTMLDivElement {
    const existing = this.nodes.get(id);
    if (existing !== undefined) return existing;
    const el = document.createElement("div");
    el.style.cssText = LABEL_STYLE;
    this.appendChild(el);
    this.nodes.set(id, el);
    return el;
  }

  private clear(): void {
    for (const el of this.nodes.values()) el.remove();
    this.nodes.clear();
  }

  protected render() {
    return html`${nothing}`;
  }
}
