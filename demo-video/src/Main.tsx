import React, { useEffect, useState } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, interpolate, Sequence, staticFile } from "remotion";
import { loadFonts } from "./theme";
import { Background, Brand, Captions, Header, HookTitle, Outro, StudioChips } from "./Overlays";
import { BrowserWindow, GSHOTS } from "./Window";
import { f, PLACED, TOTAL, voF } from "./timeline";

export type Props = { bgm: boolean };

const hook = PLACED[0]!;
const outro = PLACED[PLACED.length - 1]!;
const WINDOW_IN = hook.from + voF(1.95);
const WINDOW_OUT = outro.from + voF(2.5);

// Sound effects pinned to picture events. Every `from` is derived from the timeline, never a
// bare frame number, so re-timing the voice keeps them in sync.
type Sfx = { from: number; src: string; volume: number; dur?: number; note: string };
const SFX: Sfx[] = [
  { from: WINDOW_IN - 4, src: "swoosh-slow.mp3", volume: 0.28, dur: f(1.8), note: "window rises out of the page" },
  ...GSHOTS.filter((g) => g.mode === "scene" && g.start > WINDOW_IN + 10 && g.scene.kind !== "outro").map((g) => ({
    from: g.start - 3,
    src: "transition-soft.mp3",
    volume: 0.32,
    note: `scene change → ${g.scene.id}`,
  })),
  ...GSHOTS.filter((g) => g.mode === "fade").map((g) => ({ from: g.start - 2, src: "air-woosh-quick.mp3", volume: 0.1, note: `cut → ${g.src}` })),
  ...GSHOTS.filter((g) => g.sfx === "marker").map((g) => ({ from: g.start, src: "marker-pen-line.mp3", volume: 0.45, note: "highlight / underline lands" })),
  ...GSHOTS.filter((g) => g.sfx === "click").map((g) => ({ from: g.start, src: "switch-click-quick.mp3", volume: 0.35, note: "text box placed" })),
  ...GSHOTS.filter((g) => g.sfx === "flip").map((g) => ({ from: g.start - 2, src: "paper-page-turn.mp3", volume: 0.6, note: "flashcard flips" })),
  ...GSHOTS.filter((g) => g.sfx === "keyboard").map((g) => ({ from: g.clock + voF(0.9) - voF(0), src: "keyboard.mp3", volume: 0.22, dur: f(1.3), note: "typing the YouTube link" })),
  ...GSHOTS.filter((g) => g.sfx === "sparkle").map((g) => ({ from: g.start + 6, src: "shimmer-sparkle-sweep.mp3", volume: 0.22, dur: f(2), note: "Studio opens" })),
  // closing phrase: riser → impact on the wordmark → sparkle tail
  { from: outro.from + voF(0.4), src: "riser.mp3", volume: 0.3, dur: voF(2.78) - voF(0.4), note: "build into the wordmark" },
  { from: outro.from + voF(2.78) - 2, src: "impact-cine-big.mp3", volume: 0.5, dur: f(3.5), note: "wordmark lands" },
  { from: outro.from + voF(3.72), src: "sparkle.mp3", volume: 0.45, dur: f(3), note: "tagline shimmer" },
];

export const LinkRoomDemo: React.FC<Props> = ({ bgm }) => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    loadFonts().then(
      () => continueRender(handle),
      () => continueRender(handle),
    );
  }, [handle]);
  return (
    <AbsoluteFill>
      <Background />
      <HookTitle s={hook} />
      <Brand from={PLACED[1]!.from} to={outro.from + voF(2.5)} />
      {PLACED.filter((s) => s.chapter).map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.dur} layout="none">
          <HeaderAt s={s} />
        </Sequence>
      ))}
      <BrowserWindow enter={WINDOW_IN} exit={WINDOW_OUT} />
      {PLACED.filter((s) => s.chips).map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.dur} layout="none">
          <ChipsAt s={s} />
        </Sequence>
      ))}
      <Outro s={outro} />
      <Captions />

      {PLACED.map((s) => (
        <Sequence key={s.id} from={s.from + voF(0)} durationInFrames={f(s.voDur) + 6}>
          <Audio src={staticFile(`vo/${s.id}.wav`)} volume={1} />
        </Sequence>
      ))}
      {SFX.map((s, i) => (
        <Sequence key={i} from={Math.max(0, s.from)} durationInFrames={s.dur ?? f(2.5)}>
          <Audio src={staticFile(`sfx/${s.src}`)} volume={s.volume} />
        </Sequence>
      ))}
      {bgm && (
        <Audio
          src={staticFile("bgm/bgm-tech-house.mp3")}
          volume={(fr) => {
            // sits under the voice; lifts in the open and the closing hold, fades at the end
            const inVo = PLACED.some((s) => fr >= s.from + voF(-0.1) && fr < s.from + voF(s.voDur) + 4);
            const base = inVo ? 0.085 : 0.2;
            return base * interpolate(fr, [0, 20, TOTAL - 50, TOTAL], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          }}
        />
      )}
    </AbsoluteFill>
  );
};

// Header/Chips read the absolute frame, so undo the Sequence offset.
const HeaderAt: React.FC<{ s: (typeof PLACED)[number] }> = ({ s }) => (
  <Sequence from={-s.from} layout="none">
    <Header s={s} />
  </Sequence>
);
const ChipsAt: React.FC<{ s: (typeof PLACED)[number] }> = ({ s }) => (
  <Sequence from={-s.from} layout="none">
    <StudioChips s={s} />
  </Sequence>
);

export const SFX_TABLE = SFX;
