import { Easing } from "remotion";
import sizes from "./shot-sizes.json";
import type { Key } from "./scenes";
import { EASE_CAM, WIN, WIN_H } from "./theme";

const ease = Easing.bezier(...EASE_CAM);

export const imgSize = (src: string) => {
  const [w, h] = (sizes as unknown as Record<string, [number, number]>)[src]!;
  return { w, h, dispH: (WIN.w * h) / w };
};

export type Cam = { x: number; y: number; z: number };

// Camera at time t (seconds) along a shot's keyframes. Zoom is interpolated in log space so a
// push-in feels even; the point is clamped so the window never shows past the screenshot.
export function camAt(keys: Key[], t: number, src: string): Cam {
  let c: Cam;
  if (t <= keys[0]!.t) c = { ...keys[0]! };
  else if (t >= keys[keys.length - 1]!.t) c = { ...keys[keys.length - 1]! };
  else {
    const i = keys.findIndex((k, j) => t >= k.t && t <= keys[j + 1]!.t);
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const p = ease((t - a.t) / (b.t - a.t));
    c = {
      x: a.x + (b.x - a.x) * p,
      y: a.y + (b.y - a.y) * p,
      z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * p),
    };
  }
  return clamp(c, src);
}

function clamp(c: Cam, src: string): Cam {
  const { dispH } = imgSize(src);
  const hx = 0.5 / c.z;
  const x = Math.min(1 - hx, Math.max(hx, c.x));
  const hy = WIN_H / (2 * dispH * c.z);
  const y = dispH * c.z <= WIN_H ? 0.5 : Math.min(1 - hy, Math.max(hy, c.y));
  return { x, y, z: c.z };
}

// Where an image point lands inside the window (window-local px).
export function project(c: Cam, src: string, px: number, py: number) {
  const { dispH } = imgSize(src);
  return {
    x: WIN.w / 2 + (px - c.x) * WIN.w * c.z,
    y: WIN_H / 2 + (py - c.y) * dispH * c.z,
  };
}

// CSS transform for the image layer (origin top-left).
export function layerTransform(c: Cam, src: string) {
  const { dispH } = imgSize(src);
  const tx = WIN.w / 2 - c.x * WIN.w * c.z;
  const ty = WIN_H / 2 - c.y * dispH * c.z;
  return `translate(${tx}px, ${ty}px) scale(${c.z})`;
}
