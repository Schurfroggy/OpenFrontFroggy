import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { FeedbackCategories, type FeedbackInput } from "../core/UserFeedback";
import { feedbackMetrics } from "./GameMetrics";
import { translateText as t } from "./Utils";

const drafts = new Map<
  string,
  { input: FeedbackInput; closed: boolean; sent: boolean }
>();
@customElement("game-feedback")
export class GameFeedback extends LitElement {
  @property({ attribute: false }) context: FeedbackInput["context"];
  @property() gameId = "";
  @state() private busy = false;
  @state() private error = false;
  @state() private attach = true;
  private draftGameId = "";
  private draft: ReturnType<typeof drafts.get>;
  createRenderRoot() {
    return this;
  }
  protected willUpdate() {
    if (this.gameId && this.draftGameId !== this.gameId) {
      this.draftGameId = this.gameId;
      this.draft = drafts.get(this.gameId);
      if (!this.draft) {
        this.draft = {
          closed: false,
          sent: false,
          input: {
            submissionId: crypto.randomUUID(),
            gameId: this.gameId,
            rating: null,
            categories: [],
            comment: "",
            stage: "unknown",
            context: this.context,
            diagnostics: {
              ...feedbackMetrics(this.gameId),
              browser: navigator.userAgent.slice(0, 300),
              viewport: `${window.innerWidth}×${window.innerHeight}`,
            },
          },
        };
        drafts.set(this.gameId, this.draft);
        while (drafts.size > 10) drafts.delete(drafts.keys().next().value!);
      }
    }
  }
  private async submit() {
    if (!this.draft || this.busy) return;
    this.busy = true;
    this.error = false;
    try {
      const { diagnostics, ...input } = this.draft.input;
      const response = await fetch("/api/self-hosted/feedback", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          ...(this.attach ? { diagnostics } : {}),
        }),
      });
      if (!response.ok) throw new Error("submit");
      const result = await response.json();
      if (!result.id) throw new Error("response");
      this.draft.sent = true;
    } catch {
      this.error = true;
    } finally {
      this.busy = false;
    }
  }
  render() {
    const d = this.draft;
    if (!d || d.closed) return nothing;
    const input = d.input;
    return html`<aside
      class="rounded-xl border border-white/15 bg-black/25 p-4 text-sm text-white"
    >
      <div class="flex justify-between">
        <strong>${t("feedback.title")}</strong
        ><button
          aria-label=${t("feedback.close")}
          @click=${() => {
            d.closed = true;
            this.requestUpdate();
          }}
        >
          ×
        </button>
      </div>
      ${d.sent
        ? html`<p role="status">${t("feedback.thanks")}</p>`
        : html` <div class="my-3 flex gap-2">
              ${(["good", "okay", "bad"] as const).map(
                (r) =>
                  html`<button
                    class="rounded border px-2 py-1"
                    aria-pressed=${input.rating === r}
                    @click=${() => {
                      input.rating = r;
                      this.requestUpdate();
                    }}
                  >
                    ${input.rating === r ? "✓ " : ""}${t("feedback." + r)}
                  </button>`,
              )}
            </div>
            <div class="flex flex-wrap gap-2">
              ${FeedbackCategories.map(
                (c) =>
                  html`<button
                    class="rounded border px-2 py-1"
                    aria-pressed=${input.categories.includes(c)}
                    @click=${() => {
                      input.categories = input.categories.includes(c)
                        ? input.categories.filter((v) => v !== c)
                        : [...input.categories, c];
                      this.requestUpdate();
                    }}
                  >
                    ${input.categories.includes(c) ? "✓ " : ""}${t(
                      "feedback." + c,
                    )}
                  </button>`,
              )}
            </div>
            ${input.categories.some(
              (c) => c === "performance" || c === "connection",
            )
              ? html`<label class="mt-3 block"
                  >${t("feedback.stage")}<select
                    class="block w-full bg-gray-800"
                    .value=${input.stage}
                    @change=${(e: Event) => {
                      input.stage = (e.target as HTMLSelectElement)
                        .value as FeedbackInput["stage"];
                    }}
                  >
                    ${["unknown", "early", "middle", "late", "throughout"].map(
                      (v) =>
                        html`<option value=${v}>${t("feedback." + v)}</option>`,
                    )}
                  </select></label
                >`
              : nothing}
            <textarea
              class="mt-3 w-full rounded bg-gray-800 p-2"
              rows="4"
              maxlength="500"
              aria-label=${t("feedback.comment")}
              placeholder=${t("feedback.comment")}
              .value=${input.comment}
              @input=${(e: Event) => {
                input.comment = (e.target as HTMLTextAreaElement).value;
                this.requestUpdate();
              }}
            ></textarea>
            <label class="block"
              ><input
                type="checkbox"
                .checked=${this.attach}
                @change=${(e: Event) =>
                  (this.attach = (e.target as HTMLInputElement).checked)}
              />
              ${t("feedback.attach")}</label
            >
            <details class="my-2 text-xs text-white/60">
              <summary>${t("feedback.details")}</summary>
              ${t("feedback.privacy")}
            </details>
            ${this.error
              ? html`<p role="alert">${t("feedback.failed")}</p>`
              : nothing}
            <button
              class="mt-2 rounded bg-sky-700 px-4 py-2 disabled:opacity-40"
              ?disabled=${this.busy ||
              (!input.rating &&
                !input.categories.length &&
                !input.comment.trim())}
              @click=${() => void this.submit()}
            >
              ${t(this.busy ? "feedback.sending" : "feedback.submit")}
            </button>`}
    </aside>`;
  }
}
