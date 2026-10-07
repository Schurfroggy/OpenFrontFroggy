import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import {
  changeSelfHostedPassword,
  completeSelfHostedPasswordReset,
  loadSelfHostedAccount,
  loadSelfHostedPasswordReset,
  loginSelfHostedAccount,
  logoutSelfHostedAccount,
  registerSelfHostedAccount,
  renameSelfHostedAccount,
  requestSelfHostedPasswordReset,
  type PasswordResetCredential,
  type SelfHostedAccount,
  type SelfHostedPasswordReset,
} from "./SelfHostedAccount";
import { translateText } from "./Utils";

const PASSWORD_RESET_STORAGE_KEY = "selfHostedPasswordReset";

@customElement("self-hosted-account-modal")
export class SelfHostedAccountModal extends BaseModal {
  @state() private account: SelfHostedAccount | null = null;
  @state() private loading = true;
  @state() private mode: "login" | "register" = "login";
  @state() private guestView: "credentials" | "forgot" = "credentials";
  @state() private username = "";
  @state() private password = "";
  @state() private confirmPassword = "";
  @state() private currentPassword = "";
  @state() private newPassword = "";
  @state() private resetCredential: PasswordResetCredential | null = null;
  @state() private passwordReset: SelfHostedPasswordReset | null = null;
  @state() private error = "";
  @state() private submitting = false;
  private resetPollTimer: number | null = null;

  protected onOpen(): void {
    this.error = "";
    this.loading = true;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    void loadSelfHostedAccount(true).then((account) => {
      this.account = account;
      this.username = account?.username ?? "";
      this.loading = false;
      if (!account) this.restorePasswordReset();
    });
  }

  protected onClose(): void {
    this.stopResetPolling();
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void this.refreshPasswordReset();
    }
  };

  protected renderBody() {
    return html`
      <div class="min-h-full bg-surface px-4 py-8 text-white sm:px-8">
        <div class="mx-auto max-w-2xl">
          <div class="mb-8 flex items-center justify-between">
            <div>
              <div
                class="text-xs font-bold uppercase tracking-[0.25em] text-malibu-blue"
              >
                OpenFront
              </div>
              <h1 class="mt-1 text-3xl font-black">
                ${translateText("self_hosted_account.title")}
              </h1>
            </div>
            <button
              class="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
              @click=${() => this.close()}
            >
              ${translateText("common.back")}
            </button>
          </div>
          ${this.loading
            ? html`<div
                class="rounded-2xl border border-white/10 bg-white/5 p-8 text-white/60"
              >
                ${translateText("common.loading")}
              </div>`
            : this.account
              ? this.renderProfile(this.account)
              : this.renderGuest()}
        </div>
      </div>
    `;
  }

  private renderGuest() {
    if (this.guestView === "forgot") return this.renderPasswordRecovery();
    return html`
      <div class="rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8">
        <div
          class="mb-6 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100"
        >
          ${translateText("self_hosted_account.guest_notice")}
        </div>
        <div class="mb-6 grid grid-cols-2 rounded-xl bg-black/25 p-1">
          ${(["login", "register"] as const).map(
            (mode) =>
              html`<button
                class="rounded-lg px-4 py-2 text-sm font-bold ${this.mode ===
                mode
                  ? "bg-malibu-blue text-white"
                  : "text-white/55"}"
                @click=${() => {
                  this.mode = mode;
                  this.error = "";
                }}
              >
                ${translateText(`self_hosted_account.${mode}`)}
              </button>`,
          )}
        </div>
        <form class="space-y-4" @submit=${this.submitCredentials}>
          ${this.field(
            "username",
            "text",
            this.username,
            (value) => (this.username = value),
          )}
          ${this.field(
            "password",
            "password",
            this.password,
            (value) => (this.password = value),
          )}
          ${this.mode === "register"
            ? this.field(
                "confirm_password",
                "password",
                this.confirmPassword,
                (value) => (this.confirmPassword = value),
              )
            : null}
          ${this.error
            ? html`<p class="text-sm text-red-300">${this.error}</p>`
            : null}
          <button
            class="w-full rounded-xl bg-malibu-blue px-5 py-3 font-black uppercase tracking-wider disabled:opacity-50"
            ?disabled=${this.submitting}
          >
            ${translateText(`self_hosted_account.${this.mode}`)}
          </button>
        </form>
        ${this.mode === "login"
          ? html`<button
              class="mt-5 w-full text-center text-sm text-malibu-blue hover:underline"
              @click=${() => {
                this.guestView = "forgot";
                this.error = "";
                this.restorePasswordReset();
              }}
            >
              ${translateText("self_hosted_account.forgot_password")}
            </button>`
          : null}
      </div>
    `;
  }

  private renderPasswordRecovery() {
    return html`
      <div class="rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8">
        <button
          class="mb-5 text-sm text-white/60 hover:text-white"
          @click=${() => {
            this.guestView = "credentials";
            this.stopResetPolling();
          }}
        >
          ← ${translateText("self_hosted_account.back_to_login")}
        </button>
        <h2 class="text-2xl font-black">
          ${translateText("self_hosted_account.reset_title")}
        </h2>
        <p class="mt-2 text-sm text-white/55">
          ${translateText("self_hosted_account.reset_explanation")}
        </p>
        ${this.resetCredential && this.passwordReset
          ? this.renderResetStatus(this.passwordReset)
          : html`<form
              class="mt-6 space-y-4"
              @submit=${this.submitResetRequest}
            >
              ${this.field(
                "username",
                "text",
                this.username,
                (value) => (this.username = value),
              )}
              ${this.error
                ? html`<p class="text-sm text-red-300">${this.error}</p>`
                : null}
              <button
                class="w-full rounded-xl bg-malibu-blue px-5 py-3 font-bold disabled:opacity-50"
                ?disabled=${this.submitting}
              >
                ${translateText("self_hosted_account.submit_reset")}
              </button>
            </form>`}
      </div>
    `;
  }

  private renderResetStatus(reset: SelfHostedPasswordReset) {
    const terminal = ["rejected", "expired", "cancelled", "completed"].includes(
      reset.status,
    );
    return html`
      <div class="mt-6 rounded-xl border border-white/10 bg-black/20 p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs text-white/45">
              ${translateText("self_hosted_account.reset_account")}
            </div>
            <div class="font-bold">${reset.username}</div>
          </div>
          <span
            class="rounded-full border border-white/15 px-3 py-1 text-xs font-bold"
          >
            ${translateText(`self_hosted_account.reset_${reset.status}`)}
          </span>
        </div>
        <p class="mt-4 text-sm text-white/60">
          ${translateText(`self_hosted_account.reset_${reset.status}_help`)}
        </p>
        ${reset.status === "pending"
          ? html`<button
              class="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10"
              @click=${this.refreshPasswordReset}
            >
              ${translateText("self_hosted_account.check_status")}
            </button>`
          : null}
        ${reset.status === "approved"
          ? html`<form class="mt-5 space-y-4" @submit=${this.submitNewPassword}>
              ${this.field(
                "new_password",
                "password",
                this.newPassword,
                (value) => (this.newPassword = value),
                "new-password",
              )}
              ${this.field(
                "confirm_password",
                "password",
                this.confirmPassword,
                (value) => (this.confirmPassword = value),
                "new-password",
              )}
              ${this.error
                ? html`<p class="text-sm text-red-300">${this.error}</p>`
                : null}
              <button
                class="w-full rounded-xl bg-malibu-blue px-5 py-3 font-bold disabled:opacity-50"
                ?disabled=${this.submitting}
              >
                ${translateText("self_hosted_account.set_new_password")}
              </button>
            </form>`
          : null}
        ${terminal
          ? html`<button
              class="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10"
              @click=${this.clearPasswordReset}
            >
              ${translateText("self_hosted_account.start_new_request")}
            </button>`
          : null}
      </div>
    `;
  }

  private renderProfile(account: SelfHostedAccount) {
    return html`
      <div class="space-y-5">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8">
          <div class="mb-6 flex items-center justify-between gap-4">
            <div>
              <div class="text-sm text-white/45">
                ${translateText("self_hosted_account.signed_in_as")}
              </div>
              <div class="mt-1 text-2xl font-black">${account.username}</div>
            </div>
            <span
              class="rounded-full border border-malibu-blue/30 bg-malibu-blue/10 px-3 py-1 text-xs font-bold text-malibu-blue"
            >
              ${translateText(`self_hosted_account.role_${account.role}`)}
            </span>
          </div>
          ${this.error
            ? html`<p class="mb-4 text-sm text-red-300">${this.error}</p>`
            : null}
          <dl class="mb-7 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div class="rounded-xl bg-black/20 p-4">
              <dt class="text-white/40">
                ${translateText("self_hosted_account.account_id")}
              </dt>
              <dd class="mt-1 font-mono text-xs text-white/75">
                ${account.id}
              </dd>
            </div>
            <div class="rounded-xl bg-black/20 p-4">
              <dt class="text-white/40">
                ${translateText("self_hosted_account.created_at")}
              </dt>
              <dd class="mt-1 text-white/75">
                ${new Date(account.createdAt).toLocaleDateString()}
              </dd>
            </div>
          </dl>
          <form class="space-y-4" @submit=${this.submitRename}>
            ${this.field(
              "new_username",
              "text",
              this.username,
              (value) => (this.username = value),
            )}
            <button
              class="rounded-xl bg-malibu-blue px-5 py-3 font-bold disabled:opacity-50"
              ?disabled=${this.submitting}
            >
              ${translateText("self_hosted_account.save_name")}
            </button>
          </form>
        </div>
        <div class="rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8">
          <h2 class="mb-4 text-xl font-black">
            ${translateText("self_hosted_account.change_password")}
          </h2>
          <form class="space-y-4" @submit=${this.submitPasswordChange}>
            ${this.field(
              "current_password",
              "password",
              this.currentPassword,
              (value) => (this.currentPassword = value),
              "current-password",
            )}
            ${this.field(
              "new_password",
              "password",
              this.newPassword,
              (value) => (this.newPassword = value),
              "new-password",
            )}
            ${this.field(
              "confirm_password",
              "password",
              this.confirmPassword,
              (value) => (this.confirmPassword = value),
              "new-password",
            )}
            <button
              class="rounded-xl border border-white/15 px-5 py-3 font-bold hover:bg-white/10 disabled:opacity-50"
              ?disabled=${this.submitting}
            >
              ${translateText("self_hosted_account.change_password")}
            </button>
          </form>
        </div>
        <button
          class="w-full rounded-xl border border-red-400/25 px-5 py-3 font-bold text-red-300 hover:bg-red-400/10"
          @click=${this.logout}
        >
          ${translateText("self_hosted_account.logout")}
        </button>
      </div>
    `;
  }

  private field(
    key: string,
    type: "text" | "password",
    value: string,
    update: (value: string) => void,
    autocomplete?: string,
  ) {
    return html`<label class="block">
      <span class="mb-1.5 block text-sm font-bold text-white/65"
        >${translateText(`self_hosted_account.${key}`)}</span
      >
      <input
        class="w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none focus:border-malibu-blue"
        type=${type}
        .value=${value}
        minlength=${type === "password" ? 8 : 3}
        maxlength=${type === "password" ? 128 : 20}
        required
        autocomplete=${autocomplete ??
        (key === "username" || key === "new_username"
          ? "username"
          : this.mode === "register"
            ? "new-password"
            : "current-password")}
        @input=${(event: Event) =>
          update((event.target as HTMLInputElement).value)}
      />
    </label>`;
  }

  private submitCredentials = async (event: Event) => {
    event.preventDefault();
    if (this.mode === "register" && this.password !== this.confirmPassword) {
      this.error = translateText("self_hosted_account.password_mismatch");
      return;
    }
    this.submitting = true;
    const result = await (this.mode === "login"
      ? loginSelfHostedAccount(this.username, this.password)
      : registerSelfHostedAccount(this.username, this.password));
    this.submitting = false;
    if (!result.ok) {
      this.error = translateText(`self_hosted_account.error_${result.error}`);
      return;
    }
    this.applyAccountAndReload(result.account);
  };

  private submitRename = async (event: Event) => {
    event.preventDefault();
    this.submitting = true;
    const result = await renameSelfHostedAccount(this.username);
    this.submitting = false;
    if (!result.ok) {
      this.error = translateText(`self_hosted_account.error_${result.error}`);
      return;
    }
    this.applyAccountAndReload(result.account);
  };

  private submitPasswordChange = async (event: Event) => {
    event.preventDefault();
    if (this.newPassword !== this.confirmPassword) {
      this.error = translateText("self_hosted_account.password_mismatch");
      return;
    }
    this.submitting = true;
    const result = await changeSelfHostedPassword(
      this.currentPassword,
      this.newPassword,
    );
    this.submitting = false;
    if (!result.ok) {
      this.error = translateText(`self_hosted_account.error_${result.error}`);
      return;
    }
    localStorage.removeItem("username");
    window.location.reload();
  };

  private submitResetRequest = async (event: Event) => {
    event.preventDefault();
    this.submitting = true;
    const result = await requestSelfHostedPasswordReset(this.username);
    this.submitting = false;
    if (!result.ok) {
      this.error = translateText(`self_hosted_account.error_${result.error}`);
      return;
    }
    this.resetCredential = {
      requestId: result.requestId,
      recoveryToken: result.recoveryToken,
    };
    localStorage.setItem(
      PASSWORD_RESET_STORAGE_KEY,
      JSON.stringify(this.resetCredential),
    );
    await this.refreshPasswordReset();
    this.startResetPolling();
  };

  private submitNewPassword = async (event: Event) => {
    event.preventDefault();
    if (!this.resetCredential) return;
    if (this.newPassword !== this.confirmPassword) {
      this.error = translateText("self_hosted_account.password_mismatch");
      return;
    }
    this.submitting = true;
    const result = await completeSelfHostedPasswordReset(
      this.resetCredential,
      this.newPassword,
    );
    this.submitting = false;
    if (!result.ok) {
      this.error = translateText(`self_hosted_account.error_${result.error}`);
      await this.refreshPasswordReset();
      return;
    }
    localStorage.removeItem(PASSWORD_RESET_STORAGE_KEY);
    this.applyAccountAndReload(result.account);
  };

  private restorePasswordReset() {
    const stored = localStorage.getItem(PASSWORD_RESET_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Partial<PasswordResetCredential>;
      if (
        typeof parsed.requestId === "string" &&
        typeof parsed.recoveryToken === "string"
      ) {
        this.resetCredential = {
          requestId: parsed.requestId,
          recoveryToken: parsed.recoveryToken,
        };
        this.guestView = "forgot";
        void this.refreshPasswordReset();
        this.startResetPolling();
      }
    } catch {
      localStorage.removeItem(PASSWORD_RESET_STORAGE_KEY);
    }
  }

  private refreshPasswordReset = async () => {
    if (!this.resetCredential) return;
    const result = await loadSelfHostedPasswordReset(this.resetCredential);
    if (result.ok) {
      this.passwordReset = result.reset;
      this.username = result.reset.username;
      if (result.reset.status !== "pending") this.stopResetPolling();
    } else if (result.error === "reset_not_found") {
      this.clearPasswordReset();
    }
  };

  private startResetPolling() {
    this.stopResetPolling();
    this.resetPollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void this.refreshPasswordReset();
      }
    }, 8000);
  }

  private stopResetPolling() {
    if (this.resetPollTimer !== null) {
      window.clearInterval(this.resetPollTimer);
      this.resetPollTimer = null;
    }
  }

  private clearPasswordReset = () => {
    this.stopResetPolling();
    this.resetCredential = null;
    this.passwordReset = null;
    this.error = "";
    localStorage.removeItem(PASSWORD_RESET_STORAGE_KEY);
  };

  private logout = async () => {
    await logoutSelfHostedAccount();
    localStorage.removeItem("username");
    window.location.reload();
  };

  private applyAccountAndReload(account: SelfHostedAccount) {
    localStorage.setItem("username", account.username);
    localStorage.setItem("usernameIsGenerated", "false");
    sessionStorage.removeItem("selfHostedAccountPlayToken");
    window.location.reload();
  }
}
