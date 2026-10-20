import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LitElement } from "lit";
import { loadSelfHostedAccount } from "../SelfHostedAccount";
import {
  loadFriends,
  loadGameInvites,
  sendGameInvites,
  type FriendSummary,
} from "../SelfHostedFriends";
import { showToast, translateText } from "../Utils";

/**
 * "好友" — invite the people on your friends list into THIS lobby.
 *
 * Sits next to the invite-code copy button rather than replacing it: the code
 * still works for anyone who is not on the list (or is not registered), and a
 * host who has already shared it should not lose that path.
 *
 * The list shows every friend regardless of whether they are around: the
 * server keeps an invitation for 30 minutes, so "invite now, they read it
 * later" is a supported flow rather than a dropped message.
 */
@customElement("friend-invite-button")
export class FriendInviteButton extends LitElement {
  @property({ type: String, attribute: "game-id" }) gameID = "";

  @state() private open = false;
  @state() private loading = false;
  @state() private friends: FriendSummary[] = [];
  @state() private invited = new Set<string>();
  @state() private error = "";
  @state() private busy = false;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  private onDocumentClick = (event: Event) => {
    if (!this.open) return;
    if (event.composedPath().includes(this)) return;
    this.setOpen(false);
  };

  private setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    if (open) {
      document.addEventListener("click", this.onDocumentClick);
      void this.load();
    } else {
      document.removeEventListener("click", this.onDocumentClick);
    }
  }

  private async load(): Promise<void> {
    if (this.gameID.length === 0) return;
    this.loading = true;
    this.error = "";
    try {
      const account = await loadSelfHostedAccount();
      if (account === null) {
        this.error = translateText("friends.guest");
        this.friends = [];
        return;
      }
      const [friends, invited] = await Promise.all([
        loadFriends(),
        loadGameInvites(this.gameID),
      ]);
      if (!friends.ok) {
        this.error = translateText("friends.error_generic");
        return;
      }
      this.friends = friends.data.friends;
      if (invited.ok) this.invited = new Set(invited.data.invited);
    } finally {
      this.loading = false;
    }
  }

  private async invite(usernames: string[]): Promise<void> {
    if (usernames.length === 0 || this.busy) return;
    this.busy = true;
    try {
      const result = await sendGameInvites(this.gameID, usernames);
      if (!result.ok) {
        showToast(
          result.error === "guest"
            ? translateText("friends.guest")
            : translateText("friends.error_generic"),
          "red",
        );
        return;
      }
      const next = new Set(this.invited);
      for (const name of usernames) next.add(name);
      this.invited = next;
      if (result.data.invited > 0) {
        showToast(
          translateText("friends.invite_sent", {
            count: result.data.invited,
          }),
          "green",
        );
      } else {
        showToast(translateText("friends.error_generic"), "red");
      }
    } finally {
      this.busy = false;
    }
  }

  private pending(): string[] {
    return this.friends
      .map((friend) => friend.username)
      .filter((name) => !this.invited.has(name));
  }

  render() {
    return html`
      <div class="relative">
        <button
          type="button"
          data-test-invite-friends-list
          class="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1 border border-white/10 text-white/60 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors"
          aria-haspopup="true"
          aria-expanded=${this.open ? "true" : "false"}
          title=${translateText("friends.invite_title")}
          @click=${(e: Event) => {
            e.stopPropagation();
            this.setOpen(!this.open);
          }}
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM16 7a1 1 0 00-2 0v2h-2a1 1 0 000 2h2v2a1 1 0 002 0v-2h2a1 1 0 000-2h-2V7z"
            ></path>
          </svg>
          ${translateText("friends.button")}
        </button>
        ${this.open ? this.renderPanel() : nothing}
      </div>
    `;
  }

  private renderPanel() {
    return html`
      <div
        class="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-white/10 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="mb-2 flex items-center justify-between">
          <span
            class="text-[10px] font-bold uppercase tracking-widest text-white/50"
            >${translateText("friends.invite_title")}</span
          >
          ${this.pending().length > 0
            ? html`<button
                class="text-[10px] font-bold uppercase tracking-widest text-malibu-blue hover:underline disabled:opacity-50"
                ?disabled=${this.busy}
                @click=${() => void this.invite(this.pending())}
              >
                ${translateText("friends.invite_all")}
              </button>`
            : nothing}
        </div>
        ${this.loading
          ? html`<div class="p-3 text-center text-xs text-white/50">
              ${translateText("common.loading")}
            </div>`
          : this.error
            ? html`<div class="p-3 text-center text-xs text-amber-200">
                ${this.error}
              </div>`
            : this.friends.length === 0
              ? html`<div class="p-3 text-center text-xs text-white/50">
                  ${translateText("friends.no_friends")}
                </div>`
              : html`<ul class="max-h-72 overflow-y-auto">
                  ${this.friends.map((friend) => {
                    const already = this.invited.has(friend.username);
                    return html`<li
                      class="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span class="min-w-0 truncate text-sm"
                        >${friend.username}</span
                      >
                      <button
                        class="shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${already
                          ? "bg-white/5 text-white/40"
                          : "bg-malibu-blue text-zinc-900 hover:brightness-110"} disabled:opacity-50"
                        ?disabled=${already || this.busy}
                        @click=${() => void this.invite([friend.username])}
                      >
                        ${already
                          ? translateText("friends.invited")
                          : translateText("friends.invite")}
                      </button>
                    </li>`;
                  })}
                </ul>`}
        <div class="mt-2 border-t border-white/5 pt-2 text-[10px] text-white/40">
          ${translateText("friends.invite_hint")}
        </div>
      </div>
    `;
  }
}
