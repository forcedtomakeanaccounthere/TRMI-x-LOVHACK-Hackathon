import React from "react";
import { Composition } from "remotion";
import { LinkRoomDemo } from "./Main";
import { FPS, H, W } from "./theme";
import { TOTAL } from "./timeline";

export const Root: React.FC = () => (
  <Composition
    id="LinkRoomDemo"
    component={LinkRoomDemo}
    durationInFrames={TOTAL}
    fps={FPS}
    width={W}
    height={H}
    defaultProps={{ bgm: true }}
  />
);
