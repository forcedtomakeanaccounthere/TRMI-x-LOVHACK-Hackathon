import { staticFile } from "remotion";

// Fonts are bundled in public/fonts (variable latin subsets from Google Fonts), so rendering
// needs no network. Same families as apps/frontend/src/app/layout.tsx.
const FACES: [string, string, string][] = [
  ["Cormorant Garamond", "CormorantGaramond.woff2", "normal"],
  ["Cormorant Garamond", "CormorantGaramond-italic.woff2", "italic"],
  ["Manrope", "Manrope.woff2", "normal"],
  ["Geist Mono", "GeistMono.woff2", "normal"],
];
let loading: Promise<unknown> | null = null;
// Loads the bundled fonts once per page; the composition holds rendering until they are ready.
export function loadFonts() {
  loading ??= Promise.all(
    FACES.map(([family, file, style]) => {
      const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)}) format("woff2")`, { style, weight: "200 800" });
      document.fonts.add(face);
      return face.load();
    }),
  );
  return loading;
}

export const SERIF = '"Cormorant Garamond", Georgia, serif';
export const SANS = '"Manrope", system-ui, sans-serif';
export const MONO = '"Geist Mono", ui-monospace, monospace';

export const C = {
  bg: "#f7f8fb",
  ink: "#05070d",
  royal: "#13205a",
  azure: "#2f5bff",
  pearl: "#ffffff",
  muted: "#5b6275",
  hairline: "rgba(5,7,13,0.08)",
  // reader colours used in the app for cursors and highlights
  pink: "#e2557a",
  orange: "#f97316",
  teal: "#14b8a6",
  violet: "#8b5cf6",
};

export const FPS = 30;
export const W = 1920;
export const H = 1080;

// The browser mockup: where it sits on the 1920x1080 frame.
export const WIN = { x: 230, y: 162, w: 1460, chrome: 46 };
export const WIN_H = Math.round((WIN.w * 9) / 16); // 821, the content viewport

// Motion tokens: calm, premium education product. Ease-in-out camera, no overshoot on moves,
// a small settle (1.02) only where something lands.
export const EASE_CAM = [0.65, 0, 0.35, 1] as const;
export const EASE_IN = [0.16, 1, 0.3, 1] as const;
