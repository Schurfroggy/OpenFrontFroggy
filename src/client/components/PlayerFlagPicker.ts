import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import countries from "resources/countries.json";
import nationNamesZh from "resources/lang/nations/zh-CN.json";
import { assetUrl } from "../../core/AssetUrls";
import {
  FLAG_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import { translateText } from "../Utils";
import { starIcon } from "./map/MapFavorites";

const flags = countries.filter((c) => c.code !== "xx" && !c.restricted);
const FAVORITES_KEY = "flag-favorites";
const validCodes = new Set(flags.map((c) => c.code));

function getFavoriteFlags(): Set<string> {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(FAVORITES_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(saved)
        ? saved.filter(
            (code): code is string =>
              typeof code === "string" && validCodes.has(code),
          )
        : [],
    );
  } catch {
    return new Set();
  }
}

const chineseNames = nationNamesZh as Record<string, string>;

/** Local country flags need neither the store catalog nor a purchase. */
@customElement("player-flag-picker")
export class PlayerFlagPicker extends LitElement {
  private settings = new UserSettings();
  @state() private selected = this.settings.getFlag();
  @state() private search = "";
  @state() private limit = 60;
  @state() private favorites = getFavoriteFlags();
  // Keep the order stable throughout one visit, including search/pagination.
  private favoritesAtOpen = this.favorites;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${FLAG_KEY}`,
      this.onFlagChanged,
    );
    this.onFlagChanged();
  }

  disconnectedCallback() {
    this.querySelector("dialog")?.close();
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${FLAG_KEY}`,
      this.onFlagChanged,
    );
    super.disconnectedCallback();
  }

  private onFlagChanged = () => {
    this.selected = this.settings.getFlag();
  };

  private open = () => {
    this.search = "";
    this.limit = 60;
    this.favorites = getFavoriteFlags();
    this.favoritesAtOpen = this.favorites;
    this.querySelector("dialog")?.showModal();
  };

  private select(code: string | null) {
    if (code === null) this.settings.clearFlag(true);
    else this.settings.setFlag(`country:${code}`);
    this.querySelector("dialog")?.close();
  }

  private toggleFavorite(code: string) {
    const favorites = new Set(this.favorites);
    if (favorites.has(code)) favorites.delete(code);
    else favorites.add(code);
    this.favorites = favorites;
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    } catch (error) {
      console.warn("Failed to save favorite flags:", error);
    }
  }

  render() {
    const selected = flags.find((c) => `country:${c.code}` === this.selected);
    const query = this.search.trim().toLocaleLowerCase();
    const filtered = flags
      .filter((c) =>
        `${c.name} ${c.code} ${chineseNames[`${c.name}|${c.code}`] ?? chineseNames[c.name] ?? ""}`
          .toLocaleLowerCase()
          .includes(query),
      )
      .sort(
        (a, b) =>
          Number(this.favoritesAtOpen.has(b.code)) -
          Number(this.favoritesAtOpen.has(a.code)),
      );
    return html`
      <button
        class="player-flag-trigger"
        @click=${this.open}
        aria-label=${translateText("player_flag.choose")}
        title=${translateText("player_flag.choose")}
        aria-haspopup="dialog"
      >
        ${selected
          ? html`<img
              src=${assetUrl(`flags/${selected.code}.svg`)}
              alt=${selected.name}
            />`
          : html`<span aria-hidden="true">⚑</span>`}
      </button>
      <dialog
        class="player-flag-dialog"
        aria-labelledby="player-flag-title"
        @click=${(event: MouseEvent) => {
          if (event.target !== event.currentTarget) return;
          const dialog = event.currentTarget as HTMLDialogElement;
          const box = dialog.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            dialog.close();
        }}
      >
        <div class="player-flag-header">
          <h2 id="player-flag-title">${translateText("player_flag.choose")}</h2>
          <button
            aria-label=${translateText("common.close")}
            @click=${() => this.querySelector("dialog")?.close()}
          >
            ×
          </button>
        </div>
        <input
          class="player-flag-search"
          type="search"
          autofocus
          aria-label=${translateText("cosmetics.search")}
          placeholder=${translateText("cosmetics.search")}
          .value=${this.search}
          @input=${(event: Event) => {
            this.search = (event.target as HTMLInputElement).value;
            this.limit = 60;
          }}
        />
        <div class="player-flag-grid">
          <button
            class="player-flag-option"
            aria-pressed=${this.selected === null}
            @click=${() => this.select(null)}
          >
            <span class="player-flag-empty">⚑</span
            ><span>${translateText("player_flag.none")}</span>
          </button>
          ${repeat(
            filtered.slice(0, this.limit),
            (country) => country.code,
            (country) => html`
              <div class="player-flag-tile">
                <button
                  class="player-flag-option"
                  aria-pressed=${this.selected === `country:${country.code}`}
                  @click=${() => this.select(country.code)}
                  title=${country.name}
                >
                  <img
                    src=${assetUrl(`flags/${country.code}.svg`)}
                    alt=""
                    loading="lazy"
                  />
                  <span>${country.name}</span>
                </button>
                <button
                  class="player-flag-favorite"
                  aria-pressed=${this.favorites.has(country.code)}
                  aria-label=${`${translateText(this.favorites.has(country.code) ? "map_component.unfavorite" : "map_component.favorite")} · ${country.name}`}
                  title=${translateText(
                    this.favorites.has(country.code)
                      ? "map_component.unfavorite"
                      : "map_component.favorite",
                  )}
                  @click=${() => this.toggleFavorite(country.code)}
                >
                  ${starIcon(this.favorites.has(country.code), "w-4 h-4")}
                </button>
              </div>
            `,
          )}
        </div>
        ${filtered.length === 0
          ? html`<p class="player-flag-hint">
              ${translateText("player_flag.no_results")}
            </p>`
          : ""}
        ${filtered.length > this.limit
          ? html`<button
              class="player-flag-more"
              @click=${() => (this.limit += 60)}
            >
              ${translateText("friends.load_more")}
            </button>`
          : ""}
      </dialog>
    `;
  }
}
