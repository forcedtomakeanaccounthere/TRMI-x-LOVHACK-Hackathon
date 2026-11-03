# LinkRoom demo video

A 2½-minute narrated product demo of LinkRoom, made with [Remotion](https://www.remotion.dev) (React → video).
The script is in [SCRIPT.md](SCRIPT.md). The rendered video is at [`../docs/demo/linkroom-demo.mp4`](../docs/demo/linkroom-demo.mp4).

## What it covers

Dashboard · multiple sources (PDF, Word, PowerPoint, Markdown, links, Google Drive) · YouTube → document from captions ·
annotations and text boxes · live cursors, activity feed and follow mode · Laser Focus · Huddle voice chat with AI notes ·
AI Lens · AI chat with citations · Studio (summary, quiz, flashcards, mind map, infographic) · rooms, groups, roles,
discussion, notebook and "While you were away".

## How it is built

| Piece | Where |
| --- | --- |
| Storyboard: shots, camera keyframes, callouts, spotlights | `src/scenes.ts` |
| Timing from the voice clips (scene lengths, caption timing) | `src/timeline.ts`, `src/timings.json` |
| 2.5D browser mockup, Ken Burns camera, callouts, live cursor | `src/Window.tsx`, `src/camera.ts` |
| Titles, captions, Studio chips, outro "family photo" | `src/Overlays.tsx` |
| Voice, music and sound effects (SFX pinned to timeline events) | `src/Main.tsx` |
| Design tokens (fonts and colours from the app) | `src/theme.ts` |

Screenshots in `public/shots/`: the `docs/images` set, plus `cap-*.jpg` captured with Playwright from the
no-backend demo room (`/r/demo`) for Studio outputs, annotations, the add-sources dialog and a YouTube transcript.

## Render

```bash
npm install
npm run render          # out/linkroom-demo.mp4 (with music)
npm run render:nobgm    # out/linkroom-demo-nobgm.mp4 (voice + sound effects only)
npm run studio          # preview and tweak in the browser
```

If Remotion can't download its browser, point it at a local Chromium headless shell:
`REMOTION_BROWSER=/path/to/chrome-headless-shell npm run render`.

## Changing the narration

1. Edit `script.json`.
2. Put one voice clip per scene in `public/vo/<id>.wav` (any TTS or a real recording; ElevenLabs works too).
3. `npm run timings` re-measures the clips; scene lengths, captions and sound effects follow automatically.

The current voice is the open Kokoro TTS model (voice `af_heart`).

## Credits

Music and sound effects: Mixkit free licence (via the video-shotcraft asset library). Fonts: Cormorant Garamond,
Manrope, Geist Mono (SIL Open Font License).
