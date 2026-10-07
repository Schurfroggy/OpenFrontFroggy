import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  desktopQuit,
  isDesktopShell,
  requestDesktopQuit,
} from "../DesktopShell";
import { translateText } from "../Utils";

export type WebGLGateStatus = "software" | "unsupported" | "limited";

// Hard-block troubleshooting screen seen by a tiny fraction of sessions (no
// GPU-accelerated WebGL2). Browser-specific names stay in the translations so
// the entire recovery path follows the player's selected language.
const STEP_SECTIONS: ReadonlyArray<{ titleKey: string; stepKeys: string[] }> = [
  {
    titleKey: "webgl_gate.chrome_title",
    stepKeys: [
      "webgl_gate.chrome_step_1",
      "webgl_gate.chrome_step_2",
      "webgl_gate.chrome_step_3",
      "webgl_gate.chrome_step_4",
      "webgl_gate.chrome_step_5",
      "webgl_gate.chrome_step_6",
      "webgl_gate.chrome_step_7",
      "webgl_gate.chrome_step_8",
    ],
  },
  {
    titleKey: "webgl_gate.edge_title",
    stepKeys: [
      "webgl_gate.edge_step_1",
      "webgl_gate.edge_step_2",
      "webgl_gate.edge_step_3",
      "webgl_gate.edge_step_4",
      "webgl_gate.edge_step_5",
      "webgl_gate.edge_step_6",
    ],
  },
  {
    titleKey: "webgl_gate.firefox_title",
    stepKeys: [
      "webgl_gate.firefox_step_1",
      "webgl_gate.firefox_step_2",
      "webgl_gate.firefox_step_3",
      "webgl_gate.firefox_step_4",
    ],
  },
];

// Shown for the "limited" status: WebGL works but texture sizes are capped
// below what the game needs, so the map may render with black areas (#4357).
// The only known cause is fingerprinting protection
// (privacy.resistFingerprinting — on by default in LibreWolf and Mullvad
// Browser, opt-in in Firefox). Unlike the other statuses this is a warning:
// the player may dismiss it and play anyway.
const LIMITED_SECTIONS: ReadonlyArray<{
  titleKey: string;
  stepKeys: string[];
}> = [
  {
    titleKey: "webgl_gate.limited_browser_title",
    stepKeys: [
      "webgl_gate.limited_step_1",
      "webgl_gate.limited_step_2",
      "webgl_gate.limited_step_3",
      "webgl_gate.limited_step_4",
    ],
  },
];

const LIMITED_NOTE_KEYS: string[] = [
  "webgl_gate.limited_note_1",
  "webgl_gate.limited_note_2",
];

const SAFARI_NOTE_KEYS: string[] = [
  "webgl_gate.safari_note_1",
  "webgl_gate.safari_note_2",
];

// The desktop shell bundles its own Chromium, so browser settings, flags and
// the player's default browser have no bearing on it. Restarting is what
// players report clears it. Unlike the browser steps above, these name no
// browser UI, so they are translated.
const DESKTOP_STEP_KEYS = [
  "desktop_webgl_gate.step_quit",
  "desktop_webgl_gate.step_restart_steam",
  "desktop_webgl_gate.step_restart_computer",
  "desktop_webgl_gate.step_drivers",
];

/**
 * Full-screen gate shown when the WebGL2 context is unusable ("software",
 * "unsupported" — hard block) or degraded ("limited" — texture sizes capped
 * by fingerprinting protection; dismissible via "Continue anyway"). Shows how
 * to turn hardware acceleration / WebGL back on, or exempt the site from
 * fingerprinting protection, across the most popular browsers. Shown
 * imperatively from the game-start path.
 */
@customElement("webgl-gate")
export class WebGLGate extends LitElement {
  @property() status: WebGLGateStatus = "software";

  // Render into light DOM so global styles (Tailwind utilities, bg-surface) apply.
  createRenderRoot() {
    return this;
  }

  render() {
    if (this.status !== "limited" && isDesktopShell()) {
      return this.renderDesktop();
    }
    const limited = this.status === "limited";
    const software = this.status === "software";
    const titleKey = limited
      ? "webgl_gate.title_limited"
      : software
        ? "webgl_gate.title_software"
        : "webgl_gate.title_unsupported";
    const introKey = limited
      ? "webgl_gate.intro_limited"
      : software
        ? "webgl_gate.intro_software"
        : "webgl_gate.intro_unsupported";
    const sections = limited ? LIMITED_SECTIONS : STEP_SECTIONS;
    const notesTitleKey = limited
      ? "webgl_gate.notes_title"
      : "webgl_gate.safari_title";
    const noteKeys = limited ? LIMITED_NOTE_KEYS : SAFARI_NOTE_KEYS;

    return html`
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-5"
      >
        <div
          class="w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 sm:p-8 rounded-xl bg-surface text-white shadow-2xl"
        >
          <h2 class="text-xl font-bold mb-3">${translateText(titleKey)}</h2>
          <p class="text-sm leading-relaxed text-white/85 mb-5">
            ${translateText(introKey)}
          </p>
          ${sections.map(
            (section) => html`
              <section class="mb-5">
                <h3 class="text-sm font-bold text-white mb-1.5">
                  ${translateText(section.titleKey)}
                </h3>
                <ol
                  class="pl-5 list-decimal text-sm leading-relaxed text-white/85 space-y-1.5"
                >
                  ${section.stepKeys.map(
                    (key) =>
                      html`<li>
                        ${translateText(key, {
                          hostname: window.location.hostname,
                        })}
                      </li>`,
                  )}
                </ol>
              </section>
            `,
          )}
          <section class="mb-0">
            <h3 class="text-sm font-bold text-white mb-1.5">
              ${translateText(notesTitleKey)}
            </h3>
            <ul
              class="pl-5 list-disc text-sm leading-relaxed text-white/85 space-y-1.5"
            >
              ${noteKeys.map((key) => html`<li>${translateText(key)}</li>`)}
            </ul>
          </section>
          ${limited
            ? html`
                <button
                  class="mt-5 w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold text-white transition-colors"
                  @click=${() => this.remove()}
                >
                  ${translateText("webgl_gate.continue_anyway")}
                </button>
              `
            : null}
        </div>
      </div>
    `;
  }

  private renderDesktop() {
    return html`
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-5"
      >
        <div
          class="w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 sm:p-8 rounded-xl bg-surface text-white shadow-2xl"
        >
          <h2 class="text-xl font-bold mb-3">
            ${translateText("desktop_webgl_gate.title")}
          </h2>
          <p class="text-sm leading-relaxed text-white/85 mb-5">
            ${translateText("desktop_webgl_gate.intro")}
          </p>
          <ol
            class="pl-5 list-decimal text-sm leading-relaxed text-white/85 space-y-1.5"
          >
            ${DESKTOP_STEP_KEYS.map(
              (key) => html`<li>${translateText(key)}</li>`,
            )}
          </ol>
          ${desktopQuit() !== null
            ? html`
                <button
                  class="mt-5 w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold text-white transition-colors"
                  @click=${() => requestDesktopQuit()}
                >
                  ${translateText("desktop_webgl_gate.quit")}
                </button>
              `
            : null}
        </div>
      </div>
    `;
  }
}
