// ─────────────────────────────────────────────────────────────────────────────
// JWT Auth Middleware — Supabase getUser() approach (most reliable)
// Uses SUPABASE_SERVICE_ROLE_KEY to verify any user token server-side.
// Sets req.user, req.isOwner, req.bypassLimits, req.greeting on every request.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";
import { err } from "../lib/response.js";
import { OWNER_CONFIG, isOwnerEmail } from "../config/owner.js";

const SUPABASE_URL =
  process.env["SUPABASE_URL"] ?? "https://uapvdzphibxoomokahjh.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

// Service-role client — used ONLY for token verification, never exposed to clients
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

export interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  user_metadata?: Record<string, unknown>;
  aud?: string | string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      trace_id: string;
      isOwner: boolean;
      bypassLimits: boolean;
      greeting?: string;
    }
  }
}

// ─── Optional auth — sets req.user + owner flags, never blocks ───────────────
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  req.isOwner = false;
  req.bypassLimits = false;

  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7);

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return next();
    }

    const user = data.user;
    const email = (user.email ?? "").toLowerCase();

    req.user = {
      sub:           user.id,
      email:         user.email,
      role:          user.role,
      user_metadata: user.user_metadata as Record<string, unknown> | undefined,
    };

    if (isOwnerEmail(email)) {
      req.isOwner    = true;
      req.bypassLimits = true;
      req.greeting   = OWNER_CONFIG.greeting;
      req.log?.info({ email, path: req.path }, "👑 OWNER REQUEST");
    }
  } catch {
    // Non-fatal — fail open
  }

  next();
}

// ─── Required auth — 401 if no valid token ───────────────────────────────────
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  req.isOwner    = false;
  req.bypassLimits = false;

  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json(
      err("UNAUTHORIZED", "Missing or invalid Authorization header", req.trace_id)
    );
    return;
  }

  const token = authHeader.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    req.log?.warn({ err: error }, "JWT verification failed");
    res.status(401).json(
      err("TOKEN_INVALID", "JWT token is invalid or expired", req.trace_id)
    );
    return;
  }

  const user = data.user;
  const email = (user.email ?? "").toLowerCase();

  req.user = {
    sub:           user.id,
    email:         user.email,
    role:          user.role,
    user_metadata: user.user_metadata as Record<string, unknown> | undefined,
  };

  if (isOwnerEmail(email)) {
    req.isOwner    = true;
    req.bypassLimits = true;
    req.greeting   = OWNER_CONFIG.greeting;
    req.log?.info({ email, path: req.path }, "👑 OWNER REQUEST");
  }

  next();
}

// Keep backward-compat export for any files that import verifyToken
export async function verifyToken(token: string): Promise<JwtPayload> {
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid or expired token");
  return {
    sub:           data.user.id,
    email:         data.user.email,
    role:          data.user.role,
    user_metadata: data.user.user_metadata as Record<string, unknown> | undefined,
  };
}
