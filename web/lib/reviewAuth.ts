/**
 * Who is allowed to publish.
 *
 * The review endpoint is the one place in the app where a person's judgement
 * becomes something readers are shown as religious guidance. Everything else
 * here reads; this writes, and what it writes carries a named reviewer's
 * authority. An open endpoint means anyone who finds the URL can publish a
 * ruling under that name.
 *
 * A shared secret in `REVIEW_TOKEN` is the whole mechanism. That is deliberate:
 * the app has one operator, and a login system with accounts and sessions would
 * be more code to get wrong for no more safety than a long random string.
 *
 *     REVIEW_TOKEN=$(openssl rand -hex 32)
 *
 * **Unset fails closed in production and open on loopback.** Without a token a
 * deployed instance refuses every review request rather than serving them
 * unprotected — the failure mode of forgetting to set it must be an outage, not
 * a silent hole. Local development keeps working so the review workflow is not
 * gated behind ceremony on a machine only the operator can reach.
 */

import type { NextRequest } from "next/server";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

function isLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host")?.split(":")[0] ?? "";
  return LOOPBACK.has(host);
}

/**
 * Returns a Response to send back when the caller may not review, or null when
 * they may. Call it first in every handler that touches the answer bank.
 */
export function denyReview(req: NextRequest): Response | null {
  const expected = process.env.REVIEW_TOKEN;

  if (!expected) {
    if (process.env.NODE_ENV !== "production" && isLoopback(req)) return null;
    return Response.json(
      {
        error:
          "REVIEW_TOKEN is not set, so review is disabled. Generate one with " +
          "`openssl rand -hex 32` and set it in the environment.",
      },
      { status: 503 },
    );
  }

  const presented =
    req.headers.get("x-review-token") ??
    req.nextUrl.searchParams.get("token") ??
    "";

  if (!timingSafeEqual(presented, expected)) {
    return Response.json({ error: "Not authorised to review." }, { status: 401 });
  }
  return null;
}

/**
 * Constant-time comparison. `===` on secrets leaks their prefix through timing,
 * and the endpoint is remotely reachable by assumption once a token exists.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
