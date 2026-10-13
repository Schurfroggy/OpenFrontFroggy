import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import type { EventBus } from "../../../core/EventBus";
import type { Controller } from "../../Controller";
import { MapViewMode, MapViewModeEvent } from "../../InputHandler";
import { translateText } from "../../Utils";

const samLauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");

interface ViewOption {
  mode: MapViewMode;
  icon: string | null;
  labelKey: string;
}

const VIEW_OPTIONS: ViewOption[] = [
  { mode: "default", icon: null, labelKey: "map_view.default" },
  { mode: "sam", icon: samLauncherIcon, labelKey: "map_view.sam" },
  { mode: "war", icon: swordIcon, labelKey: "map_view.war" },
];

/**
 * MapViewSelector — a vertical rail of large rounded-square buttons pinned to
 * the far-left edge of the screen (vertically centered, below the left
 * sidebar) that switches the persistent map overlay mode. The default view is
 * the plain map; the SAM view keeps every SAM range ring on screen so cities
 * and ports can be placed inside friendly coverage.
 *
 * Styling mirrors the build menu's buttons (dark fill, #444 border, 12px
 * radius, hover lift) at a larger size.
 */
@customElement("map-view-selector")
export class MapViewSelector extends LitElement implements Controller {
  @state()
  private mode: MapViewMode = "default";
  @state()
  private isVisible = false;

  public eventBus: EventBus | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    // Keep in sync when other sources (future keybinds) switch the mode.
    this.eventBus?.on(MapViewModeEvent, (e) => {
      this.mode = e.mode;
    });
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {}

  private selectMode(mode: MapViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.eventBus?.emit(new MapViewModeEvent(mode));
  }

  render() {
    if (!this.isVisible) {
      return html`<aside class="hidden"></aside>`;
    }
    return html`
      <aside
        class="fixed left-2 top-1/2 -translate-y-1/2 z-900 flex flex-col gap-2"
        role="radiogroup"
        aria-label=${translateText("map_view.title")}
      >
        ${VIEW_OPTIONS.map(
          (opt) => html`
            <div class="view-button-wrap">
              <button
                class=${`view-button ${this.mode === opt.mode ? "selected" : ""}`}
                role="radio"
                aria-checked=${this.mode === opt.mode}
                @click=${() => this.selectMode(opt.mode)}
              >
                ${opt.icon !== null
                  ? html`<img
                      src=${opt.icon}
                      alt=${translateText(opt.labelKey)}
                      width="40"
                      height="40"
                    />`
                  : html`<span class="view-letter">D</span>`}
              </button>
              <span class="view-tooltip" role="tooltip"
                >${translateText(opt.labelKey)}</span
              >
            </div>
          `,
        )}
      </aside>
    `;
  }
}

// Style element injected once at module load — plain CSS so the large buttons
// stay readable without pulling Tailwind classes into a string blob.
const styleEl = document.createElement("style");
styleEl.textContent = `
  map-view-selector .view-button-wrap {
    position: relative;
    display: flex;
  }
  map-view-selector .view-button {
    width: 72px;
    height: 72px;
    border: 2px solid #444;
    background-color: #2c2c2c;
    color: white;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 8px;
  }
  map-view-selector .view-button:hover {
    background-color: #3a3a3a;
    transform: scale(1.05);
    border-color: #666;
  }
  map-view-selector .view-button:active {
    background-color: #4a4a4a;
    transform: scale(0.95);
  }
  map-view-selector .view-button.selected {
    background-color: #4a4a4a;
    border-color: #ffd76e;
    border-width: 3px;
    box-shadow: 0 0 0 2px rgba(255, 215, 110, 0.35),
      0 0 12px rgba(255, 215, 110, 0.25);
  }
  map-view-selector .view-letter {
    font-size: 40px;
    font-weight: bold;
    line-height: 1;
  }
  map-view-selector .view-tooltip {
    position: absolute;
    left: calc(100% + 10px);
    top: 50%;
    transform: translateY(-50%) translateX(-4px);
    background-color: rgba(20, 20, 20, 0.95);
    border: 1px solid #555;
    border-radius: 8px;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    padding: 8px 12px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease, transform 0.15s ease;
    z-index: 901;
  }
  map-view-selector .view-button-wrap:hover .view-tooltip {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }
`;
document.head.appendChild(styleEl);
