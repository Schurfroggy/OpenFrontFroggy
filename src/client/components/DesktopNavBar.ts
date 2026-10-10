import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { ClientEnv } from "../ClientEnv";
import {
  loadSelfHostedAccount,
  loadSelfHostedAdminOverview,
} from "../SelfHostedAccount";
import { translateText } from "../Utils";
import "./NavAccountMenu";
import { NavNotificationsController } from "./NavNotificationsController";
import "./NavUtilityIcons";

@customElement("desktop-nav-bar")
export class DesktopNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);
  @state() private selfHostedAdmin = false;
  @state() private pendingResets = 0;
  private adminTimer: number | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);
    if (ClientEnv.selfHosted?.() === true) {
      void this.refreshAdminState();
      this.adminTimer = window.setInterval(
        () => void this.refreshAdminState(),
        15000,
      );
    }

    const current = window.currentPageId;
    if (current) {
      // Wait for render
      this.updateComplete.then(() => {
        this._updateActiveState(current);
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("showPage", this._onShowPage);
    if (this.adminTimer !== null) window.clearInterval(this.adminTimer);
  }

  private _onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this._updateActiveState(pageId);
  };

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });
  }

  private async refreshAdminState() {
    const account = await loadSelfHostedAccount(true);
    this.selfHostedAdmin = account?.role === "admin";
    if (!this.selfHostedAdmin) {
      this.pendingResets = 0;
      return;
    }
    const overview = await loadSelfHostedAdminOverview();
    this.pendingResets =
      overview?.resets.filter((reset) => reset.status === "pending").length ??
      0;
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <nav
        class="hidden lg:flex w-full bg-zinc-900/90 backdrop-blur-md items-center justify-center gap-8 py-4 shrink-0 z-50 relative"
      >
        <div class="flex flex-col items-center justify-center">
          <div class="h-8">
            <img
              class="block h-full aspect-[1364/259]"
              src=${assetUrl("images/OpenFrontLogo.svg")}
              alt="OpenFront"
            />
          </div>
          <div
            id="game-version"
            class="l-header__highlightText text-center"
          ></div>
        </div>
        <button
          class="nav-menu-item ${currentPage === "page-play"
            ? "active"
            : ""} text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
          data-page="page-play"
          data-i18n="main.play"
        ></button>
        ${ClientEnv.selfHosted?.() === true
          ? html`<button
              class="nav-menu-item ${currentPage === "page-self-hosted-account"
                ? "active"
                : ""} text-white/70 hover:text-malibu-blue font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue"
              data-page="page-self-hosted-account"
              data-i18n="main.my_account"
            ></button>`
          : nothing}
        ${this.selfHostedAdmin
          ? html`<button
              class="nav-menu-item relative ${currentPage ===
              "page-self-hosted-admin"
                ? "active"
                : ""} text-white/70 hover:text-malibu-blue font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue"
              data-page="page-self-hosted-admin"
            >
              <span>${translateText("main.admin")}</span>
              ${this.pendingResets > 0
                ? html`<span
                    class="absolute -right-3 -top-2 flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-5 text-white"
                    >${this.pendingResets}</span
                  >`
                : nothing}
            </button>`
          : nothing}
        <!-- Desktop Navigation Menu Items -->
        ${ClientEnv.selfHosted?.() === true
          ? nothing
          : html`<div class="relative no-crazygames">
                <button
                  class="nav-menu-item ${currentPage === "page-item-store"
                    ? "active"
                    : ""} text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
                  data-page="page-item-store"
                  data-i18n="main.store"
                  @click=${this._notifications.onStoreClick}
                ></button>
                ${this._notifications.showStoreDot()
                  ? html`
                      <span
                        class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"
                      ></span>
                      <span
                        class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"
                      ></span>
                    `
                  : ""}
              </div>
              <button
                class="nav-menu-item ${currentPage === "page-inventory"
                  ? "active"
                  : ""} text-white/70 hover:text-malibu-blue font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue"
                data-page="page-inventory"
                data-i18n="main.inventory"
              ></button>
              <button
                class="nav-menu-item text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
                data-page="page-leaderboard"
                data-i18n="main.leaderboard"
              ></button>
              <button
                class="no-crazygames nav-menu-item text-white/70 hover:text-blue-500 font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-blue-500"
                data-page="page-clan"
                data-i18n="main.clans"
              ></button>`}
        <!-- Utility cluster: bell, help, settings and the profile control are
             account/notification/utility affordances rather than page links,
             so they sit tight together behind a divider instead of in the nav
             item list. -->
        <div class="flex items-center gap-1 pl-5 ml-1 border-l border-white/10">
          <nav-utility-icons size="desktop"></nav-utility-icons>
          ${ClientEnv.selfHosted?.() === true
            ? nothing
            : html`<nav-account-menu variant="desktop"></nav-account-menu>`}
        </div>
      </nav>
    `;
  }
}
