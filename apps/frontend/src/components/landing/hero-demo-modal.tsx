"use client";

import { PlayIcon } from "@phosphor-icons/react";
import { useLenis } from "lenis/react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const VIDEO_ID = "SGm599w1M3U";

export function HeroDemoModal() {
  const [open, setOpen] = useState(false);
  const lenis = useLenis();

  useEffect(() => {
    if (open) lenis?.stop();
    else lenis?.start();
  }, [open, lenis]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-3 text-[0.875rem] font-medium text-foreground/80 transition-colors hover:text-foreground"
        >
          <span className="liquid-glass grid size-11 place-items-center rounded-full transition-transform duration-500 ease-fluid group-hover:scale-110">
            <PlayIcon weight="fill" className="size-3.5 translate-x-px text-azure" />
          </span>
          Watch it in action
        </button>
      </DialogTrigger>
      <DialogContent
        data-lenis-prevent
        className="liquid-glass liquid-glass-strong w-[min(64rem,calc(100%-2rem))] max-w-none gap-0 rounded-[2rem] p-0 ring-0 duration-500 ease-out-expo data-open:zoom-in-90 data-open:slide-in-from-bottom-6 data-closed:zoom-out-95 sm:max-w-none [&>*[data-slot=dialog-close]]:z-20 [&>*[data-slot=dialog-close]]:rounded-full [&>*[data-slot=dialog-close]]:bg-background/80 [&>*[data-slot=dialog-close]]:text-foreground [&>*[data-slot=dialog-close]]:backdrop-blur-xl"
      >
        <div className="liquid-glass relative overflow-hidden rounded-[2rem] p-2 pt-14 sm:p-3 sm:pt-14 md:p-4 md:pt-4">
          <div className="relative aspect-video overflow-hidden rounded-[1.5rem]">
            <iframe
              className="absolute inset-0 size-full"
              src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&mute=1&loop=1&playlist=${VIDEO_ID}&rel=0&playsinline=1`}
              title="The thirty-second moment"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
          <div className="mt-2 rounded-xl border border-foreground/10 bg-background/45 px-4 py-3 backdrop-blur-xl sm:mt-3 sm:px-5 sm:py-4">
            <DialogTitle className="font-display text-xl font-normal sm:text-2xl">Watch it in action</DialogTitle>
            <DialogDescription className="mt-1 text-sm">
              See LinkRoom bring every reader into the same live conversation.
            </DialogDescription>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
