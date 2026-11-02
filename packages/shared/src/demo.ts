// Demo accounts for judges and first-time visitors. apps/backend `npm run seed:demo` creates them (already
// verified) with a room full of activity; the sign-in page offers one-click sign-in as either. They are
// public on purpose, so never give them anything private.

export type DemoAccount = { email: string; password: string; name: string; color: string; blurb: string };

export const DEMO_PASSWORD = "LinkRoom-demo-2026";

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: "judge.ada@linkroom.demo",
    password: DEMO_PASSWORD,
    name: "Ada (demo)",
    color: "#2f5bff",
    blurb: "Owns the demo rooms",
  },
  {
    email: "judge.ben@linkroom.demo",
    password: DEMO_PASSWORD,
    name: "Ben (demo)",
    color: "#e2557a",
    blurb: "Reads along with Ada",
  },
];

// The title of the seeded main room, so the seed can tell it already ran.
export const DEMO_ROOM_TITLE = "Robot Perception 101 · demo room";
