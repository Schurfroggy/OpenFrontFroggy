import { z } from "zod";

const AccountSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  role: z.enum(["player", "admin"]),
  createdAt: z.string(),
});
const AccountResponseSchema = z.object({ account: AccountSchema.nullable() });
const PasswordResetSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  username: z.string(),
  status: z.enum([
    "pending",
    "approved",
    "rejected",
    "completed",
    "expired",
    "cancelled",
  ]),
  requestedAt: z.string(),
  expiresAt: z.number(),
  approvedAt: z.string().nullable(),
});
const AdminAccountSchema = AccountSchema.extend({
  activeSessions: z.number(),
});
const AdminOverviewSchema = z.object({
  accounts: z.array(AdminAccountSchema),
  resets: z.array(PasswordResetSchema),
});

export type SelfHostedAccount = z.infer<typeof AccountSchema>;
export type SelfHostedPasswordReset = z.infer<typeof PasswordResetSchema>;
export type SelfHostedAdminOverview = z.infer<typeof AdminOverviewSchema>;
export type AccountResult =
  | { ok: true; account: SelfHostedAccount }
  | { ok: false; error: string };

let cachedAccount: SelfHostedAccount | null | undefined;

export async function loadSelfHostedAccount(
  force = false,
): Promise<SelfHostedAccount | null> {
  if (!force && cachedAccount !== undefined) return cachedAccount;
  try {
    const response = await fetch("/api/self-hosted/account/me", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return (cachedAccount = null);
    const parsed = AccountResponseSchema.safeParse(await response.json());
    return (cachedAccount = parsed.success ? parsed.data.account : null);
  } catch {
    return (cachedAccount = null);
  }
}

async function submitAccount(
  endpoint: "login" | "register",
  username: string,
  password: string,
): Promise<AccountResult> {
  try {
    const response = await fetch(`/api/self-hosted/account/${endpoint}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      account?: unknown;
      error?: string;
    };
    if (!response.ok)
      return { ok: false, error: body.error ?? "request_failed" };
    const account = AccountSchema.safeParse(body.account);
    if (!account.success) return { ok: false, error: "invalid_response" };
    cachedAccount = account.data;
    return { ok: true, account: account.data };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

export const loginSelfHostedAccount = (username: string, password: string) =>
  submitAccount("login", username, password);

export const registerSelfHostedAccount = (username: string, password: string) =>
  submitAccount("register", username, password);

export async function renameSelfHostedAccount(
  username: string,
): Promise<AccountResult> {
  try {
    const response = await fetch("/api/self-hosted/account/profile", {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      account?: unknown;
      error?: string;
    };
    if (!response.ok)
      return { ok: false, error: body.error ?? "request_failed" };
    const account = AccountSchema.safeParse(body.account);
    if (!account.success) return { ok: false, error: "invalid_response" };
    cachedAccount = account.data;
    return { ok: true, account: account.data };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

export async function changeSelfHostedPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/self-hosted/account/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (response.ok) {
      cachedAccount = null;
      sessionStorage.removeItem("selfHostedAccountPlayToken");
      return { ok: true };
    }
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    return { ok: false, error: body.error ?? "request_failed" };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

export interface PasswordResetCredential {
  requestId: string;
  recoveryToken: string;
}

export async function requestSelfHostedPasswordReset(
  username: string,
): Promise<
  ({ ok: true } & PasswordResetCredential) | { ok: false; error: string }
> {
  try {
    const response = await fetch("/api/self-hosted/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      return {
        ok: false,
        error: typeof body.error === "string" ? body.error : "request_failed",
      };
    }
    const parsed = z
      .object({ requestId: z.uuid(), recoveryToken: z.string() })
      .safeParse(body);
    if (!parsed.success) return { ok: false, error: "invalid_response" };
    return { ok: true, ...parsed.data };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

export async function loadSelfHostedPasswordReset(
  credential: PasswordResetCredential,
): Promise<
  { ok: true; reset: SelfHostedPasswordReset } | { ok: false; error: string }
> {
  try {
    const response = await fetch("/api/self-hosted/password-reset/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credential),
    });
    const body = (await response.json().catch(() => ({}))) as {
      reset?: unknown;
      error?: string;
    };
    if (!response.ok)
      return { ok: false, error: body.error ?? "request_failed" };
    const reset = PasswordResetSchema.safeParse(body.reset);
    return reset.success
      ? { ok: true, reset: reset.data }
      : { ok: false, error: "invalid_response" };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

export async function completeSelfHostedPasswordReset(
  credential: PasswordResetCredential,
  newPassword: string,
): Promise<AccountResult> {
  try {
    const response = await fetch("/api/self-hosted/password-reset/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...credential, newPassword }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      account?: unknown;
      error?: string;
    };
    if (!response.ok)
      return { ok: false, error: body.error ?? "request_failed" };
    const account = AccountSchema.safeParse(body.account);
    if (!account.success) return { ok: false, error: "invalid_response" };
    cachedAccount = account.data;
    return { ok: true, account: account.data };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

export async function loadSelfHostedAdminOverview(): Promise<SelfHostedAdminOverview | null> {
  try {
    const response = await fetch("/api/self-hosted/admin/overview");
    if (!response.ok) return null;
    const parsed = AdminOverviewSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function reviewSelfHostedPasswordReset(
  requestId: string,
  decision: "approved" | "rejected",
): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/self-hosted/admin/password-resets/${encodeURIComponent(requestId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function logoutSelfHostedAccount(): Promise<void> {
  await fetch("/api/self-hosted/account/logout", { method: "POST" }).catch(
    () => undefined,
  );
  cachedAccount = null;
  sessionStorage.removeItem("selfHostedAccountPlayToken");
}

export async function selfHostedAccountPlayToken(): Promise<string | null> {
  try {
    const response = await fetch("/api/self-hosted/account/play-token", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const parsed = z
      .object({ token: z.uuid() })
      .safeParse(await response.json());
    if (!parsed.success) return null;
    sessionStorage.setItem("selfHostedAccountPlayToken", parsed.data.token);
    return parsed.data.token;
  } catch {
    return null;
  }
}
