import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { FeedbackStatuses, type FeedbackInput } from "../core/UserFeedback";
import { translateText as t } from "./Utils";
type Row = {
  id: string;
  username: string;
  created_at: string;
  status: string;
  note: string;
  payload: FeedbackInput;
};
@customElement("admin-feedback")
export class AdminFeedback extends LitElement {
  @state() private rows: Row[] = [];
  @state() private page = 0;
  @state() private total = 0;
  @state() private status = "";
  @state() private search = "";
  @state() private error = false;
  @state() private busy = false;
  createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }
  private async load() {
    if (this.busy) return;
    this.busy = true;
    this.error = false;
    try {
      const response = await fetch(
        `/api/self-hosted/admin/feedback?${new URLSearchParams({ page: String(this.page), status: this.status, q: this.search })}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("load");
      const data = await response.json();
      this.rows = data.items;
      this.total = data.total;
    } catch {
      this.error = true;
    } finally {
      this.busy = false;
    }
  }
  private async save(row: Row) {
    if (this.busy) return;
    this.busy = true;
    this.error = false;
    try {
      const response = await fetch(
        `/api/self-hosted/admin/feedback/${row.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: row.status, note: row.note }),
        },
      );
      if (!response.ok) throw new Error("save");
    } catch {
      this.error = true;
    } finally {
      this.busy = false;
    }
  }
  render() {
    return html`<section class="mb-8 rounded-xl border border-white/15 p-4">
      <h2 class="text-xl">${t("feedback.admin")}</h2>
      <div class="my-3 flex flex-wrap gap-2">
        <select
          class="bg-gray-800"
          aria-label=${t("feedback.status")}
          @change=${(e: Event) => {
            this.status = (e.target as HTMLSelectElement).value;
            this.page = 0;
            void this.load();
          }}
        >
          <option value="">${t("feedback.all")}</option>
          ${FeedbackStatuses.map(
            (s) => html`<option value=${s}>${t("feedback." + s)}</option>`,
          )}
        </select>
        <input
          class="bg-gray-800 p-2"
          maxlength="100"
          aria-label=${t("feedback.search")}
          placeholder=${t("feedback.search")}
          @input=${(e: Event) =>
            (this.search = (e.target as HTMLInputElement).value)}
        />
        <button
          ?disabled=${this.busy}
          @click=${() => {
            this.page = 0;
            void this.load();
          }}
        >
          ${t("feedback.search_button")}
        </button>
      </div>
      ${this.error ? html`<p role="alert">${t("feedback.failed")}</p>` : ""}
      ${this.rows.map(
        (row) =>
          html`<details class="my-2 rounded border border-white/15 p-3">
            <summary>
              ${new Date(
                row.created_at.replace(" ", "T") + "Z",
              ).toLocaleString()}
              · ${row.username} · ${row.payload.context.map} ·
              ${t("feedback." + row.status)} ·
              ${row.payload.categories
                .map((c) => t("feedback." + c))
                .join(" / ")}
            </summary>
            <p class="whitespace-pre-wrap">${row.payload.comment}</p>
            <p>${t("feedback.stage")}: ${t("feedback." + row.payload.stage)}</p>
            <pre class="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
${JSON.stringify(
                {
                  rating: row.payload.rating,
                  gameId: row.payload.gameId,
                  context: row.payload.context,
                  diagnostics: row.payload.diagnostics,
                },
                null,
                2,
              )}</pre
            >
            <select
              class="bg-gray-800"
              aria-label=${t("feedback.status")}
              .value=${row.status}
              @change=${(e: Event) =>
                (row.status = (e.target as HTMLSelectElement).value)}
            >
              ${FeedbackStatuses.map(
                (s) => html`<option value=${s}>${t("feedback." + s)}</option>`,
              )}
            </select>
            <textarea
              class="my-2 block w-full bg-gray-800 p-2"
              maxlength="2000"
              aria-label=${t("feedback.note")}
              placeholder=${t("feedback.note")}
              .value=${row.note}
              @input=${(e: Event) =>
                (row.note = (e.target as HTMLTextAreaElement).value)}
            ></textarea>
            <button ?disabled=${this.busy} @click=${() => void this.save(row)}>
              ${t("feedback.save")}
            </button>
          </details>`,
      )}
      <div class="flex gap-4">
        <button
          ?disabled=${this.page === 0 || this.busy}
          @click=${() => {
            this.page--;
            void this.load();
          }}
        >
          ←</button
        ><span>${this.page + 1} · ${this.total}</span
        ><button
          ?disabled=${(this.page + 1) * 20 >= this.total || this.busy}
          @click=${() => {
            this.page++;
            void this.load();
          }}
        >
          →
        </button>
      </div>
    </section>`;
  }
}
