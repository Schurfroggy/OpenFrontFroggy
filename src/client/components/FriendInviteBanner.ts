import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { LitElement } from "lit";
import { currentInbox, FRIENDS_INBOX_EVENT } from "../FriendsPolling";
import { setGameInviteStatus, type GameInvite } from "../SelfHostedFriends";
import { translateText } from "../Utils";

/**
 * "Froggy 邀请你加入一场对局" — the only surface that reaches a player who is
 * already inside a match, where the nav bar is out of the way.
 *
 * Mounted once next to <main-layout> so it survives page switches; it reads
 * the shared inbox poller instead of polling on its own.
 */
@customElement("friend-invite-banner")
export class FriendInviteBanner extends LitElement {
  @state() private invites: GameInvite[] = [];
  // Locally hidden after 忽略, so the next poll cannot resurrect it while the
  // server round-trip is in flight.
  private hiddenInvites = new Set<string>();

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(FRIENDS_INBOX_EVENT, this.onInbox);
    this.apply(currentInbox()?.invites ?? []);
  }

  disconnectedCallback(): void {
    window.removeEventListener(FRIENDS_INBOX_EVENT, this.onInbox);
    super.disconnectedCallback();
  }

  private onInbox = (event: Event) => {
    const detail = (event as CustomEvent<{ invites?: GameInvite[] } | null>)
      .detail;
    this.apply(detail?.invites ?? []);
  };

  private apply(invites: GameInvite[]): void {
    this.invites = invites.filter((invite) => !this.hiddenInvites.has(invite.id));
  }

  private enter(invite: GameInvite): void {
    this.hiddenInvites.add(invite.id);
    this.apply(this.invites);
    void setGameInviteStatus(invite.id, "accept");
    window.dispatchEvent(
      new CustomEvent("selfHostedGameInvite", {
        detail: { gameID: invite.gameID },
      }),
    );
  }

  private dismiss(invite: GameInvite): void {
    this.hiddenInvites.add(invite.id);
    this.apply(this.invites);
    void setGameInviteStatus(invite.id, "dismiss");
  }

  render() {
    const invite = this.invites[0];
    if (invite === undefined) return nothing;
    const extra = this.invites.length - 1;
    return html`
      <div
        class="fixed left-1/2 top-4 z-[10011] w-[min(92vw,26rem)] -translate-x-1/2 rounded-2xl border border-malibu-blue/40 bg-zinc-900/95 p-4 text-white shadow-2xl backdrop-blur"
        role="status"
      >
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-bold">
              ${translateText("friends.banner_text", {
                name: invite.fromUsername,
              })}
            </div>
            ${extra > 0
              ? html`<div class="mt-1 text-xs text-white/60">
                  ${translateText("friends.banner_more", { count: extra })}
                </div>`
              : nothing}
          </div>
          <button
            class="shrink-0 rounded-lg bg-malibu-blue px-3 py-1.5 text-xs font-bold text-zinc-900 hover:brightness-110"
            @click=${() => this.enter(invite)}
          >
            ${translateText("friends.enter_game")}
          </button>
          <button
            class="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10"
            @click=${() => this.dismiss(invite)}
          >
            ${translateText("friends.dismiss")}
          </button>
        </div>
      </div>
    `;
  }
}
