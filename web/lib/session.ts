/**
 * Anonymous sessions.
 *
 * Someone with a sincere question should be able to ask it without creating an
 * account first, so identity here is a signed cookie rather than a login. The
 * signature stops a visitor from editing the cookie to read someone else's
 * conversations; it is not a substitute for real auth, which replaces this when
 * accounts land.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { env } from "./env";

const COOKIE = "deen_session";
const MAX_AGE = 60 * 60 * 24 * 365;

function sign(value: string): string {
  return createHmac("sha256", env.sessionSecret).update(value).digest("hex");
}

function verify(signed: string): string | null {
  const at = signed.lastIndexOf(".");
  if (at <= 0) return null;

  const value = signed.slice(0, at);
  const provided = signed.slice(at + 1);
  const expected = sign(value);

  // Compare in constant time, and only after a length check — timingSafeEqual
  // throws on mismatched lengths.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return null;
  }
  return value;
}

/**
 * Return the caller's session id, minting one if absent.
 *
 * Route handlers cannot always set cookies directly on a streaming response, so
 * the Set-Cookie header is returned for the caller to attach.
 */
export async function getOrCreateSessionId(): Promise<{
  sessionId: string;
  setCookie?: string;
}> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;

  if (existing) {
    const verified = verify(existing);
    if (verified) return { sessionId: verified };
  }

  const id = randomUUID();
  const signed = `${id}.${sign(id)}`;
  const setCookie =
    `${COOKIE}=${signed}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}` +
    (process.env.NODE_ENV === "production" ? "; Secure" : "");

  return { sessionId: id, setCookie };
}

/** Read-only variant for pages, which must not mint a session as a side effect. */
export async function readSessionId(): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  return existing ? verify(existing) : null;
}
