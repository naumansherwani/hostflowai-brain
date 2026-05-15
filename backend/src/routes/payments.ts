import { Router, type IRouter, type Request, type Response } from "express";
import { Webhook } from "svix";
import { requireAuth } from "../middleware/jwt.js";
import { ok, err } from "../lib/response.js";
import { eventBus } from "../lib/event-bus.js";
import { notifyFounderP1, notifyFounderInfo } from "../lib/notify-founder.js";

const router: IRouter = Router();

const POLAR_ACCESS_TOKEN    = process.env["POLAR_ACCESS_TOKEN"] ?? "";
const POLAR_WEBHOOK_SECRET  = process.env["POLAR_WEBHOOK_SECRET"] ?? "";
const POLAR_API             = "https://api.polar.sh";

// ─── Polar product IDs → internal plan names ──────────────────────────────────
// Source of truth: Polar dashboard (hostflowai.net org)
// Last synced: 2026-05-06
const PRODUCT_PLAN_MAP: Record<string, string> = {
  // ── Regular pricing ──────────────────────────────────────────────────────────
  "8f3ead9d-b508-472b-96ce-1963ee9deef4": "basic",    // HostFlow AI Basic — £25/mo
  "c6a0eda4-8de5-4a17-877a-fbe8281310f9": "basic",    // HostFlow AI Basic (v2) — £25/mo
  "576a5611-4bec-477d-9ace-07a86b0f83d1": "pro",      // HostFlow AI PRO — £52/mo
  "91c1a68a-8fc4-4c72-831b-c14a5a04fb4e": "premium",  // HostFlow AI Premium — £108/mo
  // ── Launch offer pricing (first 100 users, Apr 18 – Jul 30) ─────────────────
  "e0d06a0b-a7bd-4f82-9daa-04a0e08501d9": "pro",      // HostFlow AI Pro Launch -15% — £44.20/mo
  // NOTE: Launch Basic (£22) and Launch Premium (£86.40) products need creating in Polar dashboard
};

// ─── Public product catalogue — what Lovable shows on pricing page ─────────────
// Lovable calls GET /api/payments/products and uses these IDs for checkout
const PRODUCT_CATALOGUE = [
  {
    plan:          "basic",
    name:          "Basic",
    regular_price: 2500,   // GBP pence
    launch_price:  2200,   // GBP pence — launch offer
    currency:      "gbp",
    product_id:    "8f3ead9d-b508-472b-96ce-1963ee9deef4",  // use regular until launch product created
    launch_product_id: null as string | null, // TODO: create in Polar dashboard
    is_launch_active:  true,
    launch_ends_at:    "2026-07-30T23:59:59Z",
  },
  {
    plan:          "pro",
    name:          "Pro",
    regular_price: 5200,
    launch_price:  4420,
    currency:      "gbp",
    product_id:    "576a5611-4bec-477d-9ace-07a86b0f83d1",   // regular
    launch_product_id: "e0d06a0b-a7bd-4f82-9daa-04a0e08501d9", // launch -15%
    is_launch_active:  true,
    launch_ends_at:    "2026-07-30T23:59:59Z",
  },
  {
    plan:          "premium",
    name:          "Premium",
    regular_price: 10800,
    launch_price:  8640,
    currency:      "gbp",
    product_id:    "91c1a68a-8fc4-4c72-831b-c14a5a04fb4e",  // regular
    launch_product_id: null as string | null, // TODO: create in Polar dashboard
    is_launch_active:  true,
    launch_ends_at:    "2026-07-30T23:59:59Z",
  },
];

// ─── Helper: Verify Polar webhook signature (Svix) ────────────────────────────
function verifyPolarSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string
): { ok: boolean; payload?: Record<string, unknown> } {
  if (!secret) return { ok: false };
  try {
    const wh = new Webhook(secret);
    const payload = wh.verify(rawBody, headers as Record<string, string>) as Record<string, unknown>;
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

// ─── Helper: Upsert subscription in DB ────────────────────────────────────────
async function upsertSubscription(userId: string, data: {
  polarSubscriptionId: string;
  plan:                string;
  status:              string;
  currentPeriodEnd:    Date | null;
  cancelAtPeriodEnd:   boolean;
}) {
  const { db, subscriptions } = await import("@workspace/db");
  const { eq }                = await import("drizzle-orm");

  const existing = await db.select().from(subscriptions)
    .where(eq(subscriptions.userId, userId)).limit(1);

  if (existing.length > 0) {
    await db.update(subscriptions).set({
      plan:               data.plan,
      status:             data.status,
      currentPeriodEnd:   data.currentPeriodEnd,
      cancelAtPeriodEnd:  data.cancelAtPeriodEnd,
      updatedAt:          new Date(),
    }).where(eq(subscriptions.userId, userId));
  } else {
    await db.insert(subscriptions).values({
      userId:             userId,
      plan:               data.plan,
      status:             data.status,
      currentPeriodEnd:   data.currentPeriodEnd,
      cancelAtPeriodEnd:  data.cancelAtPeriodEnd,
      trialEndsAt:        null,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/webhook
// Polar calls this URL on every payment event — NO JWT (Polar signs it instead)
// rawBody captured in app.ts via express.json verify callback
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payments/webhook", async (req: Request & { rawBody?: Buffer }, res: Response) => {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    let payload: Record<string, unknown>;

    if (POLAR_WEBHOOK_SECRET) {
      // Svix verifies: webhook-id, webhook-timestamp, webhook-signature headers
      const result = verifyPolarSignature(rawBody, req.headers as Record<string, string>, POLAR_WEBHOOK_SECRET);
      if (!result.ok) {
        req.log.warn({ headers: Object.keys(req.headers) }, "Polar webhook signature mismatch — rejected");
        res.status(401).json(err("WEBHOOK_INVALID", "Invalid webhook signature", req.trace_id));
        return;
      }
      payload = result.payload ?? {};
    } else {
      req.log.warn("POLAR_WEBHOOK_SECRET not set — skipping signature check");
      try {
        payload = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
      } catch {
        res.status(400).json(err("PARSE_ERROR", "Invalid JSON body", req.trace_id));
        return;
      }
    }

    const eventType = (payload["type"] as string) ?? (payload["event"] as string) ?? "unknown";
    req.log.info({ eventType }, "Polar webhook received");

    try {
      await handlePolarEvent(eventType, payload, req);
    } catch (e) {
      req.log.error({ err: e, eventType }, "Polar webhook handler error");
      // Still return 200 so Polar doesn't retry indefinitely
    }

    res.json(ok({ received: true, event: eventType }, req.trace_id));
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Handle each Polar event type
// ─────────────────────────────────────────────────────────────────────────────
async function handlePolarEvent(
  eventType: string,
  payload:   Record<string, unknown>,
  req:       Request
): Promise<void> {
  switch (eventType) {
    // ── Checkout completed → subscription activated ──────────────────────────
    case "checkout.updated": {
      const data   = payload["data"] as Record<string, unknown> ?? payload;
      const status = (data["status"] as string) ?? "";
      if (status !== "succeeded") break;

      const userId  = (data["customer_metadata"] as Record<string, string> | undefined)?.["user_id"]
                   ?? (data["metadata"] as Record<string, string> | undefined)?.["user_id"]
                   ?? "";
      const product = data["product"] as Record<string, string> | undefined;
      const plan    = (product?.["id"] ? PRODUCT_PLAN_MAP[product["id"]] : undefined) ?? "premium";

      if (!userId) { req.log.warn({ data }, "Polar checkout.updated: no user_id in metadata"); break; }

      await upsertSubscription(userId, {
        polarSubscriptionId: (data["subscription_id"] as string) ?? "",
        plan,
        status:              "active",
        currentPeriodEnd:    null,
        cancelAtPeriodEnd:   false,
      });

      eventBus.broadcast("payment.success", {
        user_id: userId, plan, event: "checkout.succeeded",
      }, req.trace_id);

      req.log.info({ userId, plan }, "Checkout succeeded — subscription activated");

      // Notify Founder — checkout completed
      notifyFounderInfo(
        `New ${plan.toUpperCase()} checkout completed`,
        `A user has just completed checkout and activated a ${plan} subscription.\n\nPlan: ${plan}\nUser ID: ${userId}`,
        { userId, plan, event: "checkout.succeeded" }
      );
      break;
    }

    // ── Subscription created ─────────────────────────────────────────────────
    case "subscription.created": {
      const data    = payload["data"] as Record<string, unknown> ?? payload;
      const userId  = (data["customer_metadata"] as Record<string, string> | undefined)?.["user_id"]
                   ?? (data["metadata"] as Record<string, string> | undefined)?.["user_id"]
                   ?? "";
      const product = data["product"] as Record<string, string> | undefined;
      const plan    = (product?.["id"] ? PRODUCT_PLAN_MAP[product["id"]] : undefined) ?? "premium";
      const endDate = data["current_period_end"] as string | undefined;

      if (!userId) { req.log.warn({ data }, "subscription.created: no user_id"); break; }

      await upsertSubscription(userId, {
        polarSubscriptionId: (data["id"] as string) ?? "",
        plan,
        status:              "active",
        currentPeriodEnd:    endDate ? new Date(endDate) : null,
        cancelAtPeriodEnd:   false,
      });

      eventBus.broadcast("subscription.created", { user_id: userId, plan }, req.trace_id);
      req.log.info({ userId, plan }, "Subscription created");

      // Notify Founder — new paying subscriber
      notifyFounderInfo(
        `New ${plan.toUpperCase()} subscriber`,
        `A new ${plan} subscription has been created.\n\nPlan: ${plan}\nUser ID: ${userId}`,
        { userId, plan, event: "subscription.created" }
      );
      break;
    }

    // ── Subscription updated (renewal, upgrade, downgrade) ───────────────────
    case "subscription.updated": {
      const data       = payload["data"] as Record<string, unknown> ?? payload;
      const userId     = (data["customer_metadata"] as Record<string, string> | undefined)?.["user_id"]
                      ?? (data["metadata"] as Record<string, string> | undefined)?.["user_id"]
                      ?? "";
      const product    = data["product"] as Record<string, string> | undefined;
      const plan       = (product?.["id"] ? PRODUCT_PLAN_MAP[product["id"]] : undefined) ?? "premium";
      const status     = (data["status"] as string) ?? "active";
      const endDate    = data["current_period_end"] as string | undefined;
      const cancelFlag = (data["cancel_at_period_end"] as boolean) ?? false;

      if (!userId) { req.log.warn({ data }, "subscription.updated: no user_id"); break; }

      await upsertSubscription(userId, {
        polarSubscriptionId: (data["id"] as string) ?? "",
        plan,
        status,
        currentPeriodEnd:    endDate ? new Date(endDate) : null,
        cancelAtPeriodEnd:   cancelFlag,
      });

      eventBus.broadcast("subscription.updated", { user_id: userId, plan, status }, req.trace_id);
      req.log.info({ userId, plan, status }, "Subscription updated");
      break;
    }

    // ── Subscription active (Polar confirms it's live) ───────────────────────
    case "subscription.active": {
      const data    = payload["data"] as Record<string, unknown> ?? payload;
      const userId  = (data["customer_metadata"] as Record<string, string> | undefined)?.["user_id"]
                   ?? (data["metadata"] as Record<string, string> | undefined)?.["user_id"]
                   ?? "";
      const product = data["product"] as Record<string, string> | undefined;
      const plan    = (product?.["id"] ? PRODUCT_PLAN_MAP[product["id"]] : undefined) ?? "premium";
      const endDate = data["current_period_end"] as string | undefined;

      if (!userId) { req.log.warn({ data }, "subscription.active: no user_id"); break; }

      await upsertSubscription(userId, {
        polarSubscriptionId: (data["id"] as string) ?? "",
        plan,
        status:              "active",
        currentPeriodEnd:    endDate ? new Date(endDate) : null,
        cancelAtPeriodEnd:   false,
      });

      eventBus.broadcast("subscription.active", { user_id: userId, plan }, req.trace_id);
      req.log.info({ userId, plan }, "Subscription active confirmed");
      break;
    }

    // ── Order paid (one-time purchase) ───────────────────────────────────────
    case "order.paid":
    case "order.created": {
      const data    = payload["data"] as Record<string, unknown> ?? payload;
      const userId  = (data["customer_metadata"] as Record<string, string> | undefined)?.["user_id"]
                   ?? (data["metadata"] as Record<string, string> | undefined)?.["user_id"]
                   ?? "";
      const amount  = (data["amount"] as number) ?? 0;
      const product = data["product"] as Record<string, string> | undefined;
      const plan    = (product?.["id"] ? PRODUCT_PLAN_MAP[product["id"]] : undefined) ?? "lifetime";

      req.log.info({ userId, amount, plan }, "Order paid (one-time purchase)");
      eventBus.broadcast("order.paid", { user_id: userId, plan, amount }, req.trace_id);

      if (userId) {
        await upsertSubscription(userId, {
          polarSubscriptionId: (data["id"] as string) ?? "",
          plan,
          status:              "active",
          currentPeriodEnd:    null,
          cancelAtPeriodEnd:   false,
        });
      }
      break;
    }

    // ── Subscription revoked/cancelled ───────────────────────────────────────
    case "subscription.revoked":
    case "subscription.canceled":
    case "subscription.uncanceled": {
      const data      = payload["data"] as Record<string, unknown> ?? payload;
      const userId    = (data["customer_metadata"] as Record<string, string> | undefined)?.["user_id"]
                     ?? (data["metadata"] as Record<string, string> | undefined)?.["user_id"]
                     ?? "";
      const isCancel  = eventType !== "subscription.uncanceled";

      if (!userId) { req.log.warn({ data }, `${eventType}: no user_id`); break; }

      const { db, subscriptions } = await import("@workspace/db");
      const { eq }                = await import("drizzle-orm");

      if (isCancel) {
        await db.update(subscriptions).set({
          status:    eventType === "subscription.revoked" ? "cancelled" : "active",
          cancelAtPeriodEnd: eventType === "subscription.canceled",
          updatedAt: new Date(),
        }).where(eq(subscriptions.userId, userId));
        eventBus.broadcast("subscription.cancelled", { user_id: userId, event: eventType }, req.trace_id);
        req.log.info({ userId, eventType }, "Subscription cancelled/revoked");
      } else {
        // uncanceled — user changed their mind
        await db.update(subscriptions).set({
          cancelAtPeriodEnd: false,
          status:    "active",
          updatedAt: new Date(),
        }).where(eq(subscriptions.userId, userId));
        eventBus.broadcast("subscription.reactivated", { user_id: userId }, req.trace_id);
        req.log.info({ userId }, "Subscription uncanceled — reactivated");
      }
      break;
    }

    default:
      req.log.info({ eventType }, "Polar event ignored (not handled)");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/products  — Public product catalogue (Lovable reads this)
// Returns which product ID to use for checkout per plan + launch pricing status
// ─────────────────────────────────────────────────────────────────────────────
router.get("/payments/products", (_req, res) => {
  const now = new Date();
  const catalogue = PRODUCT_CATALOGUE.map(p => {
    const launchActive = p.is_launch_active && new Date(p.launch_ends_at) > now;
    const checkoutProductId = launchActive && p.launch_product_id
      ? p.launch_product_id
      : p.product_id;
    return {
      plan:              p.plan,
      name:              p.name,
      currency:          p.currency,
      regular_price:     p.regular_price,
      active_price:      launchActive ? p.launch_price : p.regular_price,
      launch_active:     launchActive,
      launch_ends_at:    launchActive ? p.launch_ends_at : null,
      checkout_product_id: checkoutProductId,  // use this for POST /api/payments/checkout
    };
  });
  res.json({
    ok:   true,
    data: { products: catalogue },
    error: null,
    trace_id: (_req as { trace_id?: string }).trace_id ?? "",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/checkout  — Create a Polar checkout session
// JWT required — user_id injected into Polar metadata
// ─────────────────────────────────────────────────────────────────────────────
router.post("/payments/checkout", requireAuth, async (req, res) => {
  const { product_id, success_url, cancel_url } = req.body as {
    product_id:  string;
    success_url?: string;
    cancel_url?:  string;
  };

  if (!product_id) {
    res.status(400).json(err("VALIDATION_ERROR", "product_id is required", req.trace_id));
    return;
  }

  if (!POLAR_ACCESS_TOKEN) {
    res.status(503).json(err("CONFIG_ERROR", "Payment system not configured yet", req.trace_id));
    return;
  }

  try {
    const body = {
      product_id,
      customer_metadata: { user_id: req.user!.sub, email: req.user!.email ?? "" },
      metadata:          { user_id: req.user!.sub },
      success_url:       success_url ?? "https://www.hostflowai.net/dashboard?payment=success",
      cancel_url:        cancel_url  ?? "https://www.hostflowai.net/pricing?payment=cancelled",
    };

    const response = await fetch(`${POLAR_API}/v1/checkouts/`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${POLAR_ACCESS_TOKEN}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      req.log.error({ status: response.status, body: text }, "Polar checkout creation failed");
      res.status(502).json(err("POLAR_ERROR", "Failed to create checkout session", req.trace_id));
      return;
    }

    const checkout = await response.json() as Record<string, unknown>;

    req.log.info({ userId: req.user!.sub, product_id }, "Polar checkout created");
    res.json(ok({
      checkout_id:  checkout["id"],
      checkout_url: checkout["url"],
      expires_at:   checkout["expires_at"],
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Polar checkout error");
    res.status(500).json(err("INTERNAL_ERROR", "Payment service error", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/me  — Current user subscription (from DB)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/payments/me", requireAuth, async (req, res) => {
  const userId = req.user!.sub;

  try {
    const { db, subscriptions } = await import("@workspace/db");
    const { eq }                = await import("drizzle-orm");

    const rows = await db.select().from(subscriptions)
      .where(eq(subscriptions.userId, userId)).limit(1);

    const sub = rows[0];

    res.json(ok({
      has_subscription:    !!sub,
      plan:                sub?.plan               ?? "none",
      status:              sub?.status             ?? "none",
      current_period_end:  sub?.currentPeriodEnd?.toISOString()  ?? null,
      cancel_at_period_end: sub?.cancelAtPeriodEnd ?? false,
      trial_ends_at:       sub?.trialEndsAt?.toISOString()       ?? null,
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch subscription");
    res.status(500).json(err("DB_ERROR", "Failed to fetch subscription", req.trace_id));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/payments/cancel  — Cancel at period end
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/payments/cancel", requireAuth, async (req, res) => {
  const userId = req.user!.sub;

  if (!POLAR_ACCESS_TOKEN) {
    res.status(503).json(err("CONFIG_ERROR", "Payment system not configured yet", req.trace_id));
    return;
  }

  try {
    const { db, subscriptions } = await import("@workspace/db");
    const { eq }                = await import("drizzle-orm");

    const rows = await db.select().from(subscriptions)
      .where(eq(subscriptions.userId, userId)).limit(1);

    const sub = rows[0];
    if (!sub || sub.status !== "active") {
      res.status(404).json(err("NO_SUBSCRIPTION", "No active subscription found", req.trace_id));
      return;
    }

    // Mark cancel_at_period_end in DB — Polar will fire subscription.revoked at end of period
    await db.update(subscriptions).set({
      cancelAtPeriodEnd: true,
      updatedAt:         new Date(),
    }).where(eq(subscriptions.userId, userId));

    eventBus.broadcast("subscription.cancel_requested", { user_id: userId }, req.trace_id);

    req.log.info({ userId }, "Subscription cancel requested");
    res.json(ok({
      cancelled:           true,
      cancel_at_period_end: true,
      message:             "Subscription will cancel at the end of the current billing period.",
    }, req.trace_id));

  } catch (e) {
    req.log.error({ err: e }, "Cancel subscription error");
    res.status(500).json(err("INTERNAL_ERROR", "Failed to cancel subscription", req.trace_id));
  }
});

export default router;
