"use client";

import { ReactLenis } from "lenis/react";

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  return (
    <ReactLenis
      root
      options={{
        lerp: 0.09,
        wheelMultiplier: 0.95,
        smoothWheel: true,
        anchors: { offset: -96 },
        // Panels that scroll on their own (a room's panes, a modal's body) keep their wheel events.
        allowNestedScroll: true,
      }}
    >
      {children}
    </ReactLenis>
  );
}
