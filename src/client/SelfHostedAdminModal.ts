import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import {
  loadSelfHostedAdminOverview,
  reviewSelfHostedPasswordReset,
  type SelfHostedAdminOverview,
  type SelfHostedPasswordReset,
} from "./SelfHostedAccount";
import { translateText } from "./Utils";

@customElement("self-hosted-admin-modal")
export class SelfHostedAdminModal extends BaseModal {
  @state() private overview: SelfHostedAdminOverview | null = null;
  @state() private loading = true;
  @state() private forbidden = false;
  @state() private processingId: string | null = null;
  private refreshTimer: number | null = null;

  protected onOpen(): void {
    this.loading = true;
    void this.refresh();
    this.stopPolling();
    this.refreshTimer = window.setInterval(() => void this.refresh(), 10000);
  }

  protected onClose(): void {
    this.stopPolling();
  }

  protected renderBody() {
    return html`
      <div class="min-h-full bg-surface px-4 py-8 text-white sm:px-8">
        <div class="mx-auto max-w-5xl">
          <div class="mb-8 flex items-center justify-between gap-4">
            <div>
              <div
                class="text-xs font-bold uppercase tracking-[0.25em] text-malibu-blue"
              >
                OpenFront
              </div>
              <h1 class="mt-1 text-3xl font-black">
                ${translateText("self_hosted_admin.title")}
              </h1>
            </div>
            <div class="flex gap-2">
              <button
                class="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10"
                @click=${this.refresh}
              >
                ${translateText("self_hosted_admin.refresh")}
              </button>
              <button
                class="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10"
                @click=${() => this.close()}
              >
                ${translateText("common.back")}
              </button>
            </div>
          </div>
          ${this.loading
            ? html`<div class="rounded-2xl bg-white/5 p-8 text-white/60">
                ${translateText("common.loading")}
              </div>`
            : this.forbidden || !this.overview
              ? html`<div
                  class="rounded-2xl border border-red-400/20 bg-red-400/10 p-6 text-red-100"
                >
                  ${translateText("self_hosted_admin.forbidden")}
                </div>`
              : html`${this.renderRequests(this.overview.resets)}
                ${this.renderAccounts(this.overview)}`}
        </div>
      </div>
    `;
  }

  private renderRequests(resets: SelfHostedPasswordReset[]) {
    const pending = resets.filter((reset) => reset.status === "pending");
    const approved = resets.filter((reset) => reset.status === "approved");
    return html`
      <section class="mb-8">
        <div class="mb-3 flex items-end justify-between">
          <div>
            <h2 class="text-xl font-black">
              ${translateText("self_hosted_admin.password_resets")}
            </h2>
            <p class="mt-1 text-sm text-white/45">
              ${translateText("self_hosted_admin.password_resets_help")}
            </p>
          </div>
          <span
            class="rounded-full bg-malibu-blue/15 px-3 py-1 text-sm font-bold text-malibu-blue"
            >${pending.length}</span
          >
        </div>
        <div class="space-y-3">
          ${resets.length === 0
            ? html`<div
                class="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/45"
              >
                ${translateText("self_hosted_admin.no_requests")}
              </div>`
            : [...pending, ...approved].map(
                (reset) => html`
                  <article
                    class="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div class="font-bold">${reset.username}</div>
                      <div class="mt-1 text-xs text-white/45">
                        ${new Date(reset.requestedAt).toLocaleString()} ·
                        ${translateText(
                          `self_hosted_account.reset_${reset.status}`,
                        )}
                      </div>
                    </div>
                    ${reset.status === "pending"
                      ? html`<div class="flex gap-2">
                          <button
                            class="rounded-lg border border-red-400/25 px-4 py-2 text-sm font-bold text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                            ?disabled=${this.processingId === reset.id}
                            @click=${() => this.review(reset.id, "rejected")}
                          >
                            ${translateText("self_hosted_admin.reject")}
                          </button>
                          <button
                            class="rounded-lg bg-malibu-blue px-4 py-2 text-sm font-bold disabled:opacity-50"
                            ?disabled=${this.processingId === reset.id}
                            @click=${() => this.review(reset.id, "approved")}
                          >
                            ${translateText("self_hosted_admin.approve")}
                          </button>
                        </div>`
                      : html`<span class="text-sm text-emerald-300">
                          ${translateText("self_hosted_admin.awaiting_user")}
                        </span>`}
                  </article>
                `,
              )}
        </div>
      </section>
    `;
  }

  private renderAccounts(overview: SelfHostedAdminOverview) {
    return html`
      <section>
        <h2 class="mb-3 text-xl font-black">
          ${translateText("self_hosted_admin.accounts")} ·
          ${overview.accounts.length}
        </h2>
        <div class="overflow-hidden rounded-2xl border border-white/10">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[650px] text-left text-sm">
              <thead class="bg-white/8 text-xs uppercase text-white/45">
                <tr>
                  <th class="px-5 py-3">
                    ${translateText("self_hosted_account.username")}
                  </th>
                  <th class="px-5 py-3">
                    ${translateText("self_hosted_admin.role")}
                  </th>
                  <th class="px-5 py-3">
                    ${translateText("self_hosted_admin.sessions")}
                  </th>
                  <th class="px-5 py-3">
                    ${translateText("self_hosted_account.created_at")}
                  </th>
                  <th class="px-5 py-3">
                    ${translateText("self_hosted_account.account_id")}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/10 bg-white/5">
                ${overview.accounts.map(
                  (account) =>
                    html`<tr>
                      <td class="px-5 py-4 font-bold">${account.username}</td>
                      <td class="px-5 py-4">
                        ${translateText(
                          `self_hosted_account.role_${account.role}`,
                        )}
                      </td>
                      <td class="px-5 py-4">${account.activeSessions}</td>
                      <td class="px-5 py-4 text-white/60">
                        ${new Date(account.createdAt).toLocaleDateString()}
                      </td>
                      <td class="px-5 py-4 font-mono text-xs text-white/40">
                        ${account.id}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  private refresh = async () => {
    const overview = await loadSelfHostedAdminOverview();
    this.loading = false;
    this.forbidden = overview === null;
    this.overview = overview;
  };

  private async review(requestId: string, decision: "approved" | "rejected") {
    this.processingId = requestId;
    await reviewSelfHostedPasswordReset(requestId, decision);
    this.processingId = null;
    await this.refresh();
  }

  private stopPolling() {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
