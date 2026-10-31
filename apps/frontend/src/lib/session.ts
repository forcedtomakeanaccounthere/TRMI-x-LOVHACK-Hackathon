"use client";

import type { AuthSession } from "@linkroom/shared";
import { useSyncExternalStore } from "react";
import { api } from "./api";

const KEY = "linkroom-session";
const EVENT = "linkroom-session-change";

let cachedRaw: string | null = null;
let cachedSession: AuthSession | null = null;

export function getSession(): AuthSession | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
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
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
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

// Only allow same-site relative paths as post-login destinations.
export function safeNext(next: string | null | undefined, fallback = "/") {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
