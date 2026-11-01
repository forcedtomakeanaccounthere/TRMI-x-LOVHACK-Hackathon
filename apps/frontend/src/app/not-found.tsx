import type { Metadata } from "next";
import { LostThread } from "@/components/fx/lost-thread";

export const metadata: Metadata = { title: "Page not found · LinkRoom" };

export default function NotFound() {
  return (
    <LostThread
      eyebrow="Error 404 · Lost thread"
      title={
        <>
          This page slipped <span className="italic text-royal-gradient">off the thread</span>
        </>
      }
      body="The link may be mistyped, or the page has moved. Pick the thread back up from home or your rooms."
    />
  );
}
