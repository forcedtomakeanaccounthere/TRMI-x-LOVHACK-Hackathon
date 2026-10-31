"use client";

import type { AuthSession } from "@linkroom/shared";
import { useSyncExternalStore } from "react";
import { api, ApiError } from "./api";

const KEY = "linkroom-session";
const EVENT = "linkroom-session-change";
// Refresh a little before expiry so the token doesn't run out mid-request.
const REFRESH_MARGIN_S = 60;

let cachedRaw: string | null = null;
let cachedSession: AuthSession | null = null;

// When localStorage is blocked or full, the session lives in memory for this page instead.
let memoryRaw: string | null = null;
let useMemory = false;

function readRaw() {
  if (useMemory) return memoryRaw;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memoryRaw;
  }
}

export function getSession(): AuthSession | null {
  const raw = readRaw();
  // Same string → same object, so useSyncExternalStore sees a stable snapshot.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedSession = raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      cachedSession = null;
    }
  }
  return cachedSession;
}

export function setSession(session: AuthSession | null) {
  memoryRaw = session ? JSON.stringify(session) : null;
  try {
    if (memoryRaw) localStorage.setItem(KEY, memoryRaw);
    else localStorage.removeItem(KEY);
    useMemory = false;
  } catch {
    useMemory = true;
  }
  window.dispatchEvent(new Event(EVENT));
}

let refreshing: Promise<AuthSession | null> | null = null;

// The saved session with a usable access token, refreshing it when it is about to expire.
// Resolves to null (and forgets the session) when there is none or it can no longer be refreshed.
export async function getFreshSession(): Promise<AuthSession | null> {
  const session = getSession();
  if (!session) return null;
  if (session.expires_at - REFRESH_MARGIN_S > Date.now() / 1000) return session;

  // Concurrent callers share one refresh, since Supabase rotates the refresh token.
  refreshing ??= api.auth
    .refresh(session.refresh_token)
    .then((next) => {
      setSession(next);
      return next;
    })
    .catch((err: unknown) => {
      // Only a rejected refresh token ends the session; network errors leave it for a retry.
      if (err instanceof ApiError && err.status < 500) {
        setSession(null);
        return null;
      }
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useSession() {
  return useSyncExternalStore(subscribe, getSession, () => null);
}

// Revoke on the backend when possible, but always forget the session locally.
export async function signOut() {
  const session = getSession();
  setSession(null);
  if (session) await api.auth.logout(session.access_token).catch(() => {});
}

const SAME_SITE = "https://linkroom.invalid";

// Only allow same-site relative paths as post-login destinations. Resolving the path catches
// tricks a prefix check misses, such as "/\evil.example" or "/\t/evil.example".
export function safeNext(next: string | null | undefined, fallback = "/") {
  if (!next?.startsWith("/")) return fallback;
  try {
    const url = new URL(next, SAME_SITE);
    return url.origin === SAME_SITE ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
