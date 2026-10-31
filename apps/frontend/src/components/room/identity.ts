import { PRESENCE_COLORS } from "@linkroom/shared";
import { nanoid } from "nanoid";
import type { Actor } from "./types";

// Who you are in a room. Signed-in people are their account; guests get a random id and the name
// they typed, both kept in this browser (CHECKLIST Phase 2, lib/identity.ts).

const GUEST_KEY = "linkroom-guest";
const COLOR_KEY = "linkroom-color";

export type Identity = Actor & { signedIn: boolean };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked storage: the identity lasts for this page only.
  }
}

export function randomColor() {
  return PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)];
}

export function signedInIdentity(user: { id: string; name: string }): Identity {
  let color = read<string>(COLOR_KEY);
  if (!color) {
    color = randomColor();
    write(COLOR_KEY, color);
  }
  return {
    id: user.id,
    name: user.name.trim().slice(0, 40) || "You",
    color,
    signedIn: true,
  };
}

// Null until the guest has typed a name.
export function savedGuest(): Identity | null {
  const guest = read<Actor>(GUEST_KEY);
  return guest?.id && guest.name ? { ...guest, signedIn: false } : null;
}

export function saveGuest(name: string, color: string): Identity {
  const existing = read<Actor>(GUEST_KEY);
  const guest = {
    id: existing?.id ?? `guest-${nanoid(10)}`,
    name: name.trim().slice(0, 24),
    color,
  };
  write(GUEST_KEY, guest);
  return { ...guest, signedIn: false };
}

export function saveColor(color: string) {
  write(COLOR_KEY, color);
}
