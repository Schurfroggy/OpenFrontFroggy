import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  FeedbackInputSchema,
  FeedbackReviewSchema,
} from "../core/UserFeedback";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import type { UserFeedbackStore } from "./UserFeedbackStore";
interface Dependencies {
  enabled: () => boolean;
  account: (req: Request) => { id: string; username: string } | null;
  admin: (req: Request, res: Response) => { id: string } | null;
  store: () => UserFeedbackStore;
}
export function registerUserFeedbackRoutes(app: Express, deps: Dependencies) {
  const feedbackLimit = rateLimit({
    windowMs: 60_000,
    limit: 10,
    keyGenerator: (req) => deps.account(req)?.id ?? "anonymous",
  });
  app.post("/api/self-hosted/feedback", feedbackLimit, (req, res) => {
    if (!deps.enabled()) return res.sendStatus(404);
    const account = deps.account(req);
    if (!account) return res.sendStatus(401);
    const parsed = FeedbackInputSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "invalid_input" });
    try {
      return res.json({ id: deps.store().submit(account, parsed.data) });
    } catch {
      return res.status(503).json({ error: "save_failed" });
    }
  });
  app.get("/api/self-hosted/admin/feedback", (req, res) => {
    if (!deps.enabled()) return res.sendStatus(404);
    if (!deps.admin(req, res)) return;
    setNoStoreHeaders(res);
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .safeParse(req.query.page ?? 0);
    if (!page.success) return res.sendStatus(400);
    const status = z
      .enum(["", "pending", "investigating", "resolved", "archived"])
      .safeParse(req.query.status ?? "");
    const q = z
      .string()
      .max(100)
      .safeParse(req.query.q ?? "");
    if (!status.success || !q.success) return res.sendStatus(400);
    return res.json(deps.store().list(page.data, status.data, q.data));
  });
  app.patch("/api/self-hosted/admin/feedback/:id", (req, res) => {
    if (!deps.enabled()) return res.sendStatus(404);
    const admin = deps.admin(req, res);
    if (!admin) return;
    const body = FeedbackReviewSchema.safeParse(req.body);
    const id = z.uuid().safeParse(req.params.id);
    if (!body.success || !id.success) return res.sendStatus(400);
    return res.sendStatus(
      deps.store().review(id.data, admin.id, body.data.status, body.data.note)
        ? 204
        : 404,
    );
  });
}
