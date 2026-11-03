import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { camAt, imgSize, layerTransform, project } from "./camera";
import type { Callout, Scene, Shot } from "./scenes";
import { C, EASE_IN, MONO, SANS, WIN, WIN_H } from "./theme";
import { PLACED, voF } from "./timeline";

const easeIn = Easing.bezier(...EASE_IN);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Every shot of the film on one clock: absolute start frame, the frame its camera clock starts
// (the voice clock), and how it arrives (scene change, fade or a UI state change).
export type GShot = Shot & { start: number; clock: number; end: number; mode: "scene" | "fade" | "state"; scene: Scene; idx: number };
export const GSHOTS: GShot[] = (() => {
  const out: GShot[] = [];
  for (const s of PLACED) {
    s.shots.forEach((sh, i) => {
      const clock = s.from + voF(sh.at);
      const start = i === 0 && s.kind !== "hook" ? s.from : clock;
      out.push({ ...sh, start, clock, end: 0, mode: i === 0 ? "scene" : (sh.cut ?? "fade"), scene: s, idx: i });
    });
  }
  out.forEach((g, i) => (g.end = out[i + 1]?.start ?? PLACED[PLACED.length - 1]!.from + PLACED[PLACED.length - 1]!.dur));
  return out;
})();

const IN = { scene: 18, fade: 12, state: 5 };

export const BrowserWindow: React.FC<{ enter: number; exit: number }> = ({ enter, exit }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < enter) return null;

  // 2.5D entrance: the window rises out of the page, tilted back, then settles.
  const e = spring({ frame: frame - enter, fps, config: { damping: 200, mass: 1.1 }, durationInFrames: 40 });
  const exitP = interpolate(frame, [exit, exit + 26], [0, 1], { ...clamp, easing: Easing.bezier(0.7, 0, 0.84, 0) });

  // a small swing on every scene change
  const sceneStarts = GSHOTS.filter((g) => g.mode === "scene" && g.start > enter + 5).map((g) => g.start);
  const swing = sceneStarts.reduce((a, s) => {
    const p = (frame - s) / 22;
    return p > -0.2 && p < 1 ? a + Math.sin(Math.max(0, p) * Math.PI) : a;
  }, 0);

  const rotX = (1 - e) * 22;
  const ty = (1 - e) * 260 - exitP * 40;
  const scale = (0.92 + 0.08 * e) * (1 - exitP * 0.35);
  const opacity = Math.min(1, e * 1.6) * (1 - exitP);

  const visible = GSHOTS.filter((g) => frame >= g.start && frame < g.end + IN.scene + 2);

  return (
    <AbsoluteFill style={{ perspective: 2200, perspectiveOrigin: "50% 40%" }}>
      <div
        style={{
          position: "absolute",
          left: WIN.x,
          top: WIN.y,
          width: WIN.w,
          height: WIN.chrome + WIN_H,
          transform: `translateY(${ty}px) rotateX(${rotX}deg) rotateY(${-swing * 2.2}deg) scale(${scale})`,
          transformOrigin: "50% 100%",
          opacity,
          borderRadius: 22,
          background: C.pearl,
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.9) inset, 0 0 0 1px rgba(5,7,13,0.07), 0 30px 80px -20px rgba(19,32,90,0.35), 0 12px 30px -12px rgba(5,7,13,0.18)",
          overflow: "hidden",
        }}
      >
        <Chrome frame={frame} />
        <div style={{ position: "absolute", top: WIN.chrome, left: 0, width: WIN.w, height: WIN_H, overflow: "hidden", background: C.bg }}>
          {visible.map((g) => (
            <ShotLayer key={`${g.scene.id}-${g.idx}`} g={g} frame={frame} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Chrome: React.FC<{ frame: number }> = ({ frame }) => {
  const g = [...GSHOTS].reverse().find((s) => frame >= s.start);
  const path = g ? urlFor(g.src) : "linkroom.app";
  return (
    <div
      style={{
        height: WIN.chrome,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 18px",
        borderBottom: `1px solid ${C.hairline}`,
        background: "linear-gradient(#ffffff, #f4f6fb)",
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <span key={c} style={{ width: 13, height: 13, borderRadius: 99, background: c, opacity: 0.9 }} />
      ))}
      <div
        style={{
          marginLeft: 26,
          flex: 1,
          maxWidth: 620,
          height: 28,
          borderRadius: 99,
          background: "rgba(5,7,13,0.045)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
          fontFamily: SANS,
          fontSize: 15,
          color: C.muted,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.4">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        {path}
      </div>
    </div>
  );
};

function urlFor(src: string) {
  if (src.startsWith("landing")) return "linkroom.app";
  if (src.startsWith("dashboard")) return "linkroom.app/dashboard";
  if (src.startsWith("cap-")) return "linkroom.app/r/demo";
  if (src.includes("huddle") || src.includes("laser") || src.includes("live-cursors")) return "linkroom.app/r/robot-perception-101";
  if (src.startsWith("features") || src.startsWith("how")) return "linkroom.app/#inside-a-room";
  if (src.startsWith("new-room") || src.startsWith("new-group")) return "linkroom.app/dashboard";
  return "linkroom.app/r/robotic-vision";
}

const ShotLayer: React.FC<{ g: GShot; frame: number }> = ({ g, frame }) => {
  const { fps } = useVideoConfig();
  const t = (frame - g.clock) / fps;
  const cam = camAt(g.cam, t, g.src);
  const { dispH } = imgSize(g.src);

  const inLen = IN[g.mode];
  const pIn = interpolate(frame, [g.start, g.start + inLen], [0, 1], { ...clamp, easing: easeIn });
  // a shot only animates out when the next one arrives as a scene change
  const next = GSHOTS[GSHOTS.indexOf(g) + 1];
  const pOut = next && next.mode === "scene" ? interpolate(frame, [next.start, next.start + IN.scene], [0, 1], { ...clamp, easing: easeIn }) : 0;

  let tx = 0;
  let sc = 1;
  if (g.mode === "scene") tx += (1 - pIn) * 140;
  if (g.mode === "fade") sc = 1 + (1 - pIn) * 0.025;
  tx -= pOut * 140;
  const opacity = pIn * (1 - pOut);

  return (
    <AbsoluteFill style={{ opacity, transform: `translateX(${tx}px) scale(${sc})` }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: WIN.w, height: dispH, transform: layerTransform(cam, g.src), transformOrigin: "0 0" }}>
        <Img src={staticFile(`shots/${g.src}`)} style={{ width: WIN.w, height: dispH, display: "block" }} />
      </div>
      {(g.spots ?? []).map((s, i) => {
        const a = interpolate(t, [s.t, s.t + 0.5], [0, 1], clamp) * (s.until ? interpolate(t, [s.until, s.until + 0.4], [1, 0], clamp) : 1);
        const p0 = project(cam, g.src, s.x0, s.y0);
        const p1 = project(cam, g.src, s.x1, s.y1);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p0.x,
              top: p0.y,
              width: p1.x - p0.x,
              height: p1.y - p0.y,
              borderRadius: 16,
              boxShadow: `0 0 0 3000px rgba(5,7,13,${0.38 * a}), 0 0 0 ${3 * a}px ${C.azure}`,
            }}
          />
        );
      })}
      {(g.callouts ?? []).map((c, i) => (
        <CalloutPin key={i} c={c} g={g} cam={cam} t={t} frame={frame} />
      ))}
      {g.scene.cursor && g.idx === 0 && <LiveCursor g={g} t={t} cam={cam} />}
    </AbsoluteFill>
  );
};

const CalloutPin: React.FC<{ c: Callout; g: GShot; cam: ReturnType<typeof camAt>; t: number; frame: number }> = ({ c, g, cam, t, frame }) => {
  const { fps } = useVideoConfig();
  const startF = g.clock + Math.round(c.t * fps);
  const a = spring({ frame: frame - startF, fps, config: { damping: 16, mass: 0.7, stiffness: 140 } });
  const endF = Math.min(g.end, c.until !== undefined ? g.clock + Math.round(c.until * fps) : g.end);
  const out = interpolate(frame, [endF - 8, endF], [1, 0], clamp);
  if (t < c.t) return null;
  const p = project(cam, g.src, c.x, c.y);
  const color = c.color ?? C.azure;
  const side = c.side ?? "right";
  const gap = 26;
  const label: React.CSSProperties = {
    position: "absolute",
    whiteSpace: "nowrap",
    padding: "11px 20px 11px 16px",
    borderRadius: 99,
    background: C.ink,
    color: C.pearl,
    fontFamily: SANS,
    fontWeight: 600,
    fontSize: 27,
    letterSpacing: "-0.01em",
    display: "flex",
    alignItems: "center",
    gap: 12,
    boxShadow: "0 14px 34px -10px rgba(5,7,13,0.45)",
    transform: `scale(${0.86 + 0.14 * a})`,
    ...(side === "right" && { left: gap, top: 0, translate: "0 -50%", transformOrigin: "0% 50%" }),
    ...(side === "left" && { right: gap, top: 0, translate: "0 -50%", transformOrigin: "100% 50%" }),
    ...(side === "top" && { left: 0, bottom: gap, translate: "-50% 0", transformOrigin: "50% 100%" }),
    ...(side === "bottom" && { left: 0, top: gap, translate: "-50% 0", transformOrigin: "50% 0%" }),
  };
  const pulse = ((frame - startF) % 45) / 45;
  return (
    <div style={{ position: "absolute", left: p.x, top: p.y, width: 0, height: 0, opacity: Math.min(1, a) * out }}>
      <span
        style={{
          position: "absolute",
          left: -22,
          top: -22,
          width: 44,
          height: 44,
          borderRadius: 99,
          border: `3px solid ${color}`,
          transform: `scale(${0.5 + pulse * 1.1})`,
          opacity: 1 - pulse,
        }}
      />
      <span style={{ position: "absolute", left: -9, top: -9, width: 18, height: 18, borderRadius: 99, background: color, border: "3px solid white", boxShadow: "0 2px 8px rgba(0,0,0,.25)" }} />
      <div style={label}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: color, flex: "none" }} />
        {c.label}
      </div>
    </div>
  );
};

// Another reader's cursor gliding over the page: the "live" in live cursors.
const LiveCursor: React.FC<{ g: GShot; t: number; cam: ReturnType<typeof camAt> }> = ({ g, t, cam }) => {
  const cur = g.scene.cursor!;
  if (t < cur.from) return null;
  const n = cur.path.length - 1;
  const raw = Math.min(1, Math.max(0, (t - cur.from) / (cur.to - cur.from)));
  const u = Easing.bezier(0.45, 0, 0.25, 1)(raw) * n;
  const i = Math.min(n - 1, Math.floor(u));
  const fr = u - i;
  const a = cur.path[i]!;
  const b = cur.path[i + 1]!;
  // a little sideways wobble so it reads as a hand, not a tween
  const px = a[0] + (b[0] - a[0]) * fr + Math.sin(t * 3.1) * 0.003;
  const py = a[1] + (b[1] - a[1]) * fr + Math.cos(t * 2.3) * 0.004;
  const p = project(cam, g.src, px, py);
  const op = interpolate(t, [cur.from, cur.from + 0.3], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: p.x, top: p.y, opacity: op }}>
      <svg width="34" height="34" viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 3px 6px rgba(0,0,0,.25))" }}>
        <path d="M4 3l16 7-7 2.2L10.6 20z" fill={cur.color} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span
        style={{
          position: "absolute",
          left: 26,
          top: 26,
          padding: "5px 14px",
          borderRadius: 99,
          background: cur.color,
          color: "white",
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 22,
          whiteSpace: "nowrap",
        }}
      >
        {cur.name}
        <span style={{ fontFamily: MONO, fontWeight: 400, fontSize: 16, opacity: 0.8, marginLeft: 8 }}>live</span>
      </span>
    </div>
  );
};
