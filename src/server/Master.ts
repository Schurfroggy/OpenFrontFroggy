import cluster from "cluster";
import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { SelfHostedAchievementRecordSchema } from "../core/SelfHostedAchievements";
import { GameEnv } from "../core/configuration/Config";
import {
  applyCheckinState,
  CHECKIN_INTERVAL_MS,
  checkinBody,
  isRefusal,
  registeredSite,
  sendCheckin,
} from "./ClusterCheckin";
import { getDescriptor } from "./DesktopRelease";
import {
  coordinatorUrl,
  LobbyCoordinatorClient,
} from "./LobbyCoordinatorClient";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { MasterLobbyService } from "./MasterLobbyService";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { startPolling } from "./PollingLoop";
import { renderAppShell } from "./RenderHtml";
import {
  SelfHostedAccountStore,
  selfHostedSessionMaxAgeSeconds,
} from "./SelfHostedAccountStore";
import { SelfHostedAchievementStore } from "./SelfHostedAchievementStore";
import { ServerEnv } from "./ServerEnv";
import { applyStaticAssetCacheControl } from "./StaticAssetCache";

const playlist = new MapPlaylist();
let lobbyService: MasterLobbyService;

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });
let selfHostedAchievementStore: SelfHostedAchievementStore | null = null;
let selfHostedAccountStore: SelfHostedAccountStore | null = null;

function achievementStore(): SelfHostedAchievementStore {
  selfHostedAchievementStore ??= new SelfHostedAchievementStore();
  return selfHostedAchievementStore;
}

function accountStore(): SelfHostedAccountStore {
  selfHostedAccountStore ??= new SelfHostedAccountStore();
  return selfHostedAccountStore;
}

const SELF_HOSTED_SESSION_COOKIE = "openfront_self_hosted_session";
const accountCredentialsSchema = z.object({
  username: z.string().trim().min(3).max(20),
  password: z.string().min(8).max(128),
});
const accountRenameSchema = z.object({
  username: z.string().trim().min(3).max(20),
});
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});
const passwordResetRequestSchema = z.object({
  username: z.string().trim().min(3).max(20),
});
const passwordResetCredentialSchema = z.object({
  requestId: z.uuid(),
  recoveryToken: z.string().min(32).max(128),
});
const passwordResetCompleteSchema = passwordResetCredentialSchema.extend({
  newPassword: z.string().min(8).max(128),
});
const passwordResetReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

function cookieValue(cookieHeader: string | undefined, name: string) {
  for (const part of cookieHeader?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function sessionToken(req: express.Request): string | undefined {
  return cookieValue(req.headers.cookie, SELF_HOSTED_SESSION_COOKIE);
}

function setSessionCookie(res: express.Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${SELF_HOSTED_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${selfHostedSessionMaxAgeSeconds}`,
  );
}

function clearSessionCookie(res: express.Response): void {
  res.setHeader(
    "Set-Cookie",
    `${SELF_HOSTED_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

function requireSelfHostedAdmin(req: express.Request, res: express.Response) {
  const account = accountStore().accountForSession(sessionToken(req));
  if (!account || account.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return account;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

// Serve the shared app shell for the root document.
app.use(async (req, res, next) => {
  if (req.path === "/") {
    try {
      await renderAppShell(
        res,
        path.join(__dirname, "../../static/index.html"),
      );
    } catch (error) {
      log.error("Error rendering index.html:", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    next();
  }
});

// Desktop (Steam) shell release descriptor. See openfront-desktop's
// docs/superpowers/specs/2026-08-20-runtime-asset-updating-design.md.
//
// version.json is polled once a minute by every running desktop client, so it
// is deliberately tiny and separately cacheable; release.json is fetched only
// when that pointer changes. Both must be reachable without a bot challenge --
// see OPE-192.
const staticDir = path.join(__dirname, "../../static");
const descriptorOpts = () => ({
  clientVersion: ServerEnv.gitCommit(),
  cdnBase: ServerEnv.cdnBase(),
  // Production must have a CDN: without one this descriptor would point every
  // Steam client at this app server for ~570MB of assets. Dev and preprod have
  // no CDN, and same-origin is what the web client already does there.
  requireCdnBase: ServerEnv.env() === GameEnv.Prod,
});

app.get("/desktop/version.json", async (_req, res) => {
  try {
    const d = await getDescriptor(staticDir, descriptorOpts());
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30");
    res.json({ clientVersion: d.clientVersion, coreVersion: d.coreVersion });
  } catch (error) {
    log.error("Error building desktop version pointer:", error);
    res.status(500).json({ error: "unavailable" });
  }
});

app.get("/desktop/release.json", async (_req, res) => {
  try {
    const d = await getDescriptor(staticDir, descriptorOpts());
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30");
    res.json(d);
  } catch (error) {
    log.error("Error building desktop release descriptor:", error);
    res.status(500).json({ error: "unavailable" });
  }
});

app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res) => {
      applyStaticAssetCacheControl(
        res.setHeader.bind(res),
        res.req.originalUrl,
      );
    },
  }),
);

app.set("trust proxy", 3);
app.use(
  rateLimit({
    windowMs: 1000, // 1 second
    max: 20, // 20 requests per IP per second
  }),
);

// Apple Pay domain verification (Stripe's universal association file,
// vendored in resources/public/). Apple fetches this exact path over HTTPS when the
// domain is registered in the Stripe dashboard, and it must get the raw file:
// express.static above ignores dotfile paths (so it falls through to here)
// and the SPA fallback below would answer with the app shell, which makes
// registration fail with no error anywhere we can see. Registered after the
// rate limiter so the file read is covered by it. Verify with
// `curl https://<domain>/.well-known/apple-developer-merchantid-domain-association`.
app.get(
  "/.well-known/apple-developer-merchantid-domain-association",
  (_req, res) => {
    res.type("text/plain");
    res.sendFile(
      path.join(
        __dirname,
        "../../resources/public/.well-known/apple-developer-merchantid-domain-association",
      ),
      // sendFile refuses dotfile path segments (".well-known") by default.
      // maxAge matters beyond browsers: nginx's proxy cache honours the
      // upstream Cache-Control, and sendFile's default max-age=0 would veto
      // the nginx.conf location block that shields this route.
      { dotfiles: "allow", maxAge: "1d" },
      (err) => {
        if (err && !res.headersSent) res.status(404).end();
      },
    );
  },
);

app.use("/api", (_req, res, next) => {
  setNoStoreHeaders(res);
  next();
});

app.post("/api/self-hosted/account/register", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  const parsed = accountCredentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    const result = accountStore().register(
      parsed.data.username,
      parsed.data.password,
    );
    setSessionCookie(res, result.sessionToken);
    return res.status(201).json({ account: result.account });
  } catch (error) {
    if (error instanceof Error && error.message === "username_taken") {
      return res.status(409).json({ error: "username_taken" });
    }
    throw error;
  }
});

app.post("/api/self-hosted/account/login", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  const parsed = accountCredentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const result = accountStore().login(
    parsed.data.username,
    parsed.data.password,
  );
  if (!result) return res.status(401).json({ error: "invalid_credentials" });
  setSessionCookie(res, result.sessionToken);
  return res.json({ account: result.account });
});

app.post("/api/self-hosted/account/logout", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  accountStore().deleteSession(sessionToken(req));
  clearSessionCookie(res);
  return res.status(204).end();
});

app.get("/api/self-hosted/account/me", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  return res.json({
    account: accountStore().accountForSession(sessionToken(req)),
  });
});

app.get("/api/self-hosted/account/play-token", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  const account = accountStore().accountForSession(sessionToken(req));
  if (!account) return res.status(401).json({ error: "guest" });
  return res.json({ token: account.id });
});

app.patch("/api/self-hosted/account/profile", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  const account = accountStore().accountForSession(sessionToken(req));
  if (!account) return res.status(401).json({ error: "guest" });
  const parsed = accountRenameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    return res.json({
      account: accountStore().rename(account.id, parsed.data.username),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "username_taken") {
      return res.status(409).json({ error: "username_taken" });
    }
    throw error;
  }
});

app.patch("/api/self-hosted/account/password", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  const account = accountStore().accountForSession(sessionToken(req));
  if (!account) return res.status(401).json({ error: "guest" });
  const parsed = passwordChangeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  if (
    !accountStore().changePassword(
      account.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    )
  ) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  clearSessionCookie(res);
  return res.status(204).end();
});

app.post("/api/self-hosted/password-reset/request", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const request = accountStore().requestPasswordReset(parsed.data.username);
  if (!request) return res.status(404).json({ error: "account_not_found" });
  return res.status(201).json(request);
});

app.post("/api/self-hosted/password-reset/status", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  const parsed = passwordResetCredentialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const reset = accountStore().passwordResetStatus(
    parsed.data.requestId,
    parsed.data.recoveryToken,
  );
  if (!reset) return res.status(404).json({ error: "reset_not_found" });
  return res.json({ reset });
});

app.post("/api/self-hosted/password-reset/complete", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  const parsed = passwordResetCompleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const result = accountStore().completePasswordReset(
    parsed.data.requestId,
    parsed.data.recoveryToken,
    parsed.data.newPassword,
  );
  if (!result) return res.status(409).json({ error: "reset_not_available" });
  setSessionCookie(res, result.sessionToken);
  return res.json({ account: result.account });
});

app.get("/api/self-hosted/admin/overview", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  if (!requireSelfHostedAdmin(req, res)) return;
  return res.json(accountStore().adminOverview());
});

app.patch("/api/self-hosted/admin/password-resets/:requestId", (req, res) => {
  if (!ServerEnv.selfHosted())
    return res.status(404).json({ error: "not_found" });
  const admin = requireSelfHostedAdmin(req, res);
  if (!admin) return;
  const requestId = z.uuid().safeParse(req.params.requestId);
  const body = passwordResetReviewSchema.safeParse(req.body);
  if (!requestId.success || !body.success) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const changed = accountStore().reviewPasswordReset(
    requestId.data,
    admin.id,
    body.data.decision,
  );
  if (!changed) return res.status(409).json({ error: "reset_not_available" });
  return res.status(204).end();
});

app.get("/api/self-hosted/achievements", (req, res) => {
  if (!ServerEnv.selfHosted()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const account = accountStore().accountForSession(sessionToken(req));
  res.json({
    achievements: account ? achievementStore().list(account.id) : [],
  });
});

app.post("/api/self-hosted/achievements", (req, res) => {
  if (!ServerEnv.selfHosted()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const account = accountStore().accountForSession(sessionToken(req));
  if (!account) {
    res.status(401).json({ error: "Guests cannot earn achievements" });
    return;
  }
  const parsed = SelfHostedAchievementRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  achievementStore().record({
    ...parsed.data,
    playerId: account.id,
    playerName: account.username,
  });
  res.status(204).end();
});

// Start the master process
export async function startMaster() {
  if (!cluster.isPrimary) {
    throw new Error(
      "startMaster() should only be called in the primary process",
    );
  }

  log.info(`Primary ${process.pid} is running`);
  log.info(`Setting up ${ServerEnv.numWorkers()} workers...`);

  // A server that registers schedules nothing until the API calls it open: a
  // mistyped letter must not mint lobbies under a letter routed elsewhere.
  const registers = checkinBody(0) !== null;
  lobbyService = new MasterLobbyService(playlist, log, registers);

  const INSTANCE_ID =
    ServerEnv.env() === GameEnv.Dev
      ? "DEV_ID"
      : crypto.randomBytes(4).toString("hex");
  process.env.INSTANCE_ID = INSTANCE_ID;

  log.info(`Instance ID: ${INSTANCE_ID}`);

  // Join the site's shared public-lobby roster (LobbyCoordinatorClient.ts)
  // when LOBBY_COORDINATOR=api and this server has a public host to
  // register under, the same test as the check-in below. Started before the
  // workers fork so the first roster normally lands before scheduling
  // begins; until it does, and whenever it stops, the master schedules its
  // own lobbies exactly as it does without a coordinator.
  const hello = checkinBody(0);
  const coordinator = coordinatorUrl(registeredSite());
  if (coordinator !== null && hello !== null) {
    log.info(`Joining lobby coordinator at ${coordinator}`);
    const client = new LobbyCoordinatorClient({
      url: coordinator,
      apiKey: ServerEnv.apiKey(),
      hello: {
        letter: hello.letter,
        host: hello.host,
        version: hello.version,
        numWorkers: hello.numWorkers,
        instanceId: INSTANCE_ID,
      },
      handlers: lobbyService.coordinatorHandlers(),
      log,
    });
    lobbyService.attachCoordinator(client);
    client.start();
  }

  // Fork workers
  for (let i = 0; i < ServerEnv.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(i, worker);
    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (workerId === undefined) {
      log.error(`worker crashed could not find id`);
      return;
    }

    const workerIdNum = parseInt(workerId);
    lobbyService.removeWorker(workerIdNum);

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    log.info(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
      INSTANCE_ID,
    });

    lobbyService.registerWorker(workerIdNum, newWorker);
    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    log.info(`Master HTTP server listening on port ${PORT}`);
  });

  // Register with the API and keep checking in (docs/MultiServer.md,
  // "Server list v2"): the API's list is what clients read to find a
  // server, so a server that isn't checking in isn't offered to anyone.
  // Local development (`npm run dev`, no SUBDOMAIN) has no public host and
  // registers nowhere; every deployed host registers under its own site.
  if (registers) {
    log.info(
      `Checking in with ${ServerEnv.jwtIssuer()}/cluster/checkin every ${CHECKIN_INTERVAL_MS / 1000}s`,
    );
    let lastRefusal: string | null = null;
    startPolling(async () => {
      const body = checkinBody(lobbyService.liveGames());
      if (body === null) return;
      const result = await sendCheckin(body);
      if (isRefusal(result)) {
        if (result.refused !== lastRefusal) {
          log.error(
            `API refused check-in as letter ${body.letter} from ${body.host}: ${result.refused}. Scheduling no public lobbies until it is accepted.`,
          );
        }
        lastRefusal = result.refused;
      } else if (result !== null) {
        lastRefusal = null;
      }
      applyCheckinState(result, (active) => lobbyService.setActive(active));
    }, CHECKIN_INTERVAL_MS);
  }
}

app.get("/api/health", (_req, res) => {
  const ready = lobbyService?.isHealthy() ?? false;
  // instanceId is diagnostics: it tells the machines behind an apex apart.
  const instanceId = ServerEnv.instanceId();
  if (ready) {
    res.json({ status: "ok", instanceId });
  } else {
    res.status(503).json({ status: "unavailable", instanceId });
  }
});

// SPA fallback route
app.get("/{*splat}", async function (_req, res) {
  try {
    const htmlPath = path.join(__dirname, "../../static/index.html");
    await renderAppShell(res, htmlPath);
  } catch (error) {
    log.error("Error rendering SPA fallback:", error);
    res.status(500).send("Internal Server Error");
  }
});
