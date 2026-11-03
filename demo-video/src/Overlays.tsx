import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, EASE_IN, MONO, SANS, SERIF, WIN } from "./theme";
import { captionsFor, PLACED, TOTAL, voF, type Placed } from "./timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeIn = Easing.bezier(...EASE_IN);

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 160) * 40;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.hairline} 1px, transparent 1px), linear-gradient(90deg, ${C.hairline} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(70% 60% at 50% 40%, black, transparent)",
          opacity: 0.55,
        }}
      />
      <div style={{ position: "absolute", left: -260 + drift, top: -300, width: 1100, height: 900, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(47,91,255,0.20), transparent)" }} />
      <div style={{ position: "absolute", right: -300 - drift, bottom: -380, width: 1200, height: 1000, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(139,92,246,0.14), transparent)" }} />
    </AbsoluteFill>
  );
};

// Staggered words: each one springs up into place.
export const Words: React.FC<{ plain: string; accent?: string; start: number; size: number; color?: string; stagger?: number; align?: "left" | "center" }> = ({
  plain,
  accent,
  start,
  size,
  color = C.ink,
  stagger = 3,
  align = "left",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = [...plain.split(" ").map((w) => ({ w, it: false })), ...(accent ? accent.split(" ").map((w) => ({ w, it: true })) : [])];
  return (
    <div style={{ fontFamily: SERIF, fontSize: size, lineHeight: 1.02, color, letterSpacing: "-0.01em", textAlign: align, fontWeight: 500 }}>
      {words.map(({ w, it }, i) => {
        const p = spring({ frame: frame - start - i * stagger, fps, config: { damping: 200 }, durationInFrames: 26 });
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", paddingBottom: size * 0.12, marginBottom: -size * 0.12 }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - p) * 105}%)`,
                fontStyle: it ? "italic" : "normal",
                color: it ? C.azure : undefined,
                fontWeight: it ? 400 : 500,
              }}
            >
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
};

// Chapter header above the window, plus a thin progress line for the whole film.
export const Header: React.FC<{ s: Placed }> = ({ s }) => {
  const frame = useCurrentFrame();
  const local = frame - s.from;
  const out = interpolate(local, [s.dur - 8, s.dur], [1, 0], clamp);
  const eb = interpolate(local, [2, 14], [0, 1], { ...clamp, easing: easeIn });
  return (
    <div style={{ position: "absolute", left: WIN.x + 4, top: 22, opacity: out }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 19,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: C.azure,
          opacity: eb,
          transform: `translateX(${(1 - eb) * -16}px)`,
          marginBottom: 6,
        }}
      >
        {s.chapter}
      </div>
      <Words plain={s.title![0]} accent={s.title![1]} start={s.from + 5} size={62} />
    </div>
  );
};

export const Brand: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const a = interpolate(frame, [from, from + 15, to - 10, to], [0, 1, 1, 0], clamp);
  const prog = frame / TOTAL;
  return (
    <>
      <div style={{ position: "absolute", right: WIN.x + 4, top: 62, display: "flex", alignItems: "center", gap: 12, opacity: a }}>
        <Img src={staticFile("logo.png")} style={{ width: 40, height: 40, borderRadius: 11 }} />
        <span style={{ fontFamily: SERIF, fontSize: 38, color: C.ink, fontWeight: 500 }}>
          Link<span style={{ fontStyle: "italic", color: C.azure, fontWeight: 400 }}>Room</span>
        </span>
      </div>
      <div style={{ position: "absolute", left: WIN.x, right: WIN.x, top: 148, height: 2, background: C.hairline, opacity: a, borderRadius: 2 }}>
        <div style={{ width: `${prog * 100}%`, height: "100%", background: C.azure, borderRadius: 2 }} />
      </div>
    </>
  );
};

// Voiceover subtitles.
export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  for (const s of PLACED) {
    if (frame < s.from || frame >= s.from + s.dur) continue;
    const local = frame - s.from;
    // no subtitle while the same words are already big on screen
    if (s.kind === "hook" && local < voF(1.78)) return null;
    if (s.kind === "outro" && local >= voF(2.7)) return null;
    const c = captionsFor(s.id).find((ch) => local >= ch.from && local < ch.to + 4);
    if (!c) return null;
    const a = interpolate(local, [c.from, c.from + 5], [0, 1], clamp);
    return (
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 46, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            maxWidth: 1500,
            padding: "14px 30px",
            borderRadius: 18,
            background: "rgba(5,7,13,0.86)",
            color: "white",
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: 44,
            lineHeight: 1.2,
            letterSpacing: "-0.01em",
            textAlign: "center",
            opacity: a,
            transform: `translateY(${(1 - a) * 8}px)`,
            boxShadow: "0 18px 40px -16px rgba(5,7,13,0.5)",
          }}
        >
          {c.text}
        </div>
      </div>
    );
  }
  return null;
};

// Studio: each format stacks into a list beside the window as it is named.
export const StudioChips: React.FC<{ s: Placed }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame - s.from, [s.dur - 10, s.dur], [1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 34, top: 330, display: "flex", flexDirection: "column", gap: 16, opacity: out }}>
      {s.chips!.map((c, i) => {
        const p = spring({ frame: frame - s.from - voF(c.t), fps, config: { damping: 14, mass: 0.6, stiffness: 150 } });
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 18px 12px 12px",
              width: 176,
              borderRadius: 18,
              background: "white",
              boxShadow: "0 0 0 1px rgba(5,7,13,.06), 0 14px 30px -14px rgba(19,32,90,.35)",
              fontFamily: SANS,
              fontWeight: 600,
              fontSize: 22,
              color: C.ink,
              opacity: Math.min(1, p),
              transform: `translateX(${(1 - p) * -60}px) scale(${0.9 + 0.1 * p})`,
            }}
          >
            <span style={{ width: 30, height: 30, borderRadius: 9, background: c.color, flex: "none", boxShadow: "inset 0 1px 0 rgba(255,255,255,.35)" }} />
            {c.label}
          </div>
        );
      })}
    </div>
  );
};

// Opening line before the first screen appears.
export const HookTitle: React.FC<{ s: Placed }> = ({ s }) => {
  const frame = useCurrentFrame();
  const leave = s.from + voF(1.75);
  const out = interpolate(frame, [leave, leave + 16], [0, 1], { ...clamp, easing: Easing.bezier(0.7, 0, 0.84, 0) });
  if (frame > leave + 20) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: 1 - out, transform: `translateY(${-out * 120}px) scale(${1 - out * 0.06})` }}>
      <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: "0.3em", color: C.azure, marginBottom: 26, opacity: interpolate(frame, [4, 18], [0, 1], clamp) }}>
        THE PROBLEM
      </div>
      <Words plain="The internet is" accent="single-player." start={s.from + 6} size={150} align="center" stagger={4} />
    </AbsoluteFill>
  );
};

const COLLAGE: { src: string; x: number; y: number; r: number; from: [number, number] }[] = [
  { src: "dashboard.jpg", x: 250, y: 220, r: -6, from: [-900, -300] },
  { src: "live-cursors.jpg", x: 1670, y: 230, r: 5, from: [900, -350] },
  { src: "cap-mindmap.jpg", x: 200, y: 560, r: 4, from: [-1000, 0] },
  { src: "huddle-notes.jpg", x: 1720, y: 580, r: -4, from: [1000, 50] },
  { src: "cap-infographic.jpg", x: 330, y: 880, r: -3, from: [-700, 500] },
  { src: "laser-focus.jpg", x: 1580, y: 890, r: 4, from: [700, 500] },
  { src: "cap-youtube-doc.jpg", x: 700, y: 120, r: 3, from: [0, -600] },
  { src: "ai-lens.jpg", x: 1220, y: 130, r: -3, from: [200, -600] },
];

// The closing "family photo": a card from every feature flies in around the wordmark.
export const Outro: React.FC<{ s: Placed }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t0 = s.from + voF(2.55);
  if (frame < t0 - 2) return null;
  const mark = spring({ frame: frame - (s.from + voF(2.78)), fps, config: { damping: 12, mass: 0.9, stiffness: 120 } });
  return (
    <AbsoluteFill>
      {COLLAGE.map((c, i) => {
        const p = spring({ frame: frame - t0 - i * 2, fps, config: { damping: 18, mass: 0.9, stiffness: 90 } });
        const w = 330;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: c.x - w / 2 + (1 - p) * c.from[0],
              top: c.y - (w * 9) / 32 + (1 - p) * c.from[1],
              width: w,
              height: (w * 9) / 16,
              borderRadius: 14,
              overflow: "hidden",
              transform: `rotate(${c.r * p + (1 - p) * c.r * 3}deg)`,
              boxShadow: "0 0 0 1px rgba(5,7,13,.08), 0 24px 50px -18px rgba(19,32,90,.45)",
              opacity: Math.min(1, p * 1.5),
              background: "white",
            }}
          >
            <Img src={staticFile(`shots/${c.src}`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
          </div>
        );
      })}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 30, transform: `scale(${0.6 + 0.4 * mark})`, opacity: Math.min(1, mark * 1.4), marginTop: -40 }}>
          <Img src={staticFile("logo.png")} style={{ width: 132, height: 132, borderRadius: 34, boxShadow: "0 24px 60px -18px rgba(47,91,255,.6)" }} />
          <span style={{ fontFamily: SERIF, fontSize: 168, color: C.ink, fontWeight: 500, letterSpacing: "-0.02em" }}>
            Link<span style={{ fontStyle: "italic", color: C.azure, fontWeight: 400 }}>Room</span>
          </span>
        </div>
        <div style={{ marginTop: 18 }}>
          <Words plain="Make your next read" accent="multiplayer." start={s.from + voF(3.72)} size={74} align="center" stagger={4} />
        </div>
        <div
          style={{
            marginTop: 34,
            fontFamily: MONO,
            fontSize: 21,
            letterSpacing: "0.26em",
            color: C.muted,
            opacity: interpolate(frame, [s.from + voF(4.6), s.from + voF(5.2)], [0, 1], clamp),
          }}
        >
          PASTE A LINK · SHARE THE ROOM · READ TOGETHER
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
