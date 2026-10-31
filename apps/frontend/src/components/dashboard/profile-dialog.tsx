"use client";

import { CameraIcon, TrashIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { imageToAvatar } from "./local-prefs";
import { PersonAvatar } from "./primitives";
import { useDashboard } from "./store";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="liquid-glass liquid-glass-strong w-[min(28rem,calc(100%-2rem))] max-w-none rounded-[1.75rem] p-6 ring-0 sm:max-w-none">
        {/* Remounts on every open, so the form starts from the current profile. */}
        {open && <ProfileForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ProfileForm({ onDone }: { onDone: () => void }) {
  const { state, actions } = useDashboard();
  const { profile } = state;
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState<string | null>(profile.avatar_url);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const changed = trimmed !== profile.name || avatar !== profile.avatar_url;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file (JPG, PNG, WebP or GIF).");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("That image is over 8 MB. Try a smaller one.");
      return;
    }
    setReading(true);
    try {
      setAvatar(await imageToAvatar(file));
    } catch {
      toast.error("Couldn't read that image.");
    } finally {
      setReading(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed || !changed) return;
        if (!actions.updateProfile({ name: trimmed, avatar_url: avatar })) {
          toast.error("Your browser couldn't save that. Try a smaller image.");
          return;
        }
        toast.success("Profile updated");
        onDone();
      }}
    >
      <div className="eyebrow text-[0.5625rem] text-azure">Your profile</div>
      <DialogTitle className="mt-2 font-display text-[2rem] leading-none font-medium">
        Edit <span className="italic">profile</span>
      </DialogTitle>
      <DialogDescription className="mt-2 text-[0.8125rem] text-muted-foreground">
        Your name and picture show on your rooms and cursor. Saved on this device for now.
      </DialogDescription>

      <div className="mt-6 flex items-center gap-5">
        <PersonAvatar person={{ ...profile, name: trimmed || profile.name, avatar_url: avatar }} size="xl" className="ring-4 ring-background" />
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={reading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[0.8125rem] font-medium ring-1 ring-(--hairline) hover:bg-foreground/5 disabled:opacity-50"
          >
            <CameraIcon className="size-4" />
            {reading ? "Reading…" : avatar ? "Change photo" : "Upload photo"}
          </button>
          {avatar && (
            <button
              type="button"
              onClick={() => setAvatar(null)}
              className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[0.8125rem] font-medium text-destructive ring-1 ring-destructive/25 hover:bg-destructive/5"
            >
              <TrashIcon className="size-4" />
              Remove photo
            </button>
          )}
        </div>
      </div>

      <label className="mt-6 block">
        <span className="eyebrow text-[0.5625rem] text-muted-foreground">Display name</span>
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!trimmed}
          className="mt-2 h-12 w-full rounded-2xl bg-foreground/5 px-4 text-[0.9375rem] ring-1 ring-(--hairline) outline-none focus:ring-ring"
        />
      </label>
      {!trimmed && <p className="mt-1.5 pl-1 text-[0.75rem] text-destructive">Your name can&apos;t be empty.</p>}

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={onDone}
          className="h-11 flex-1 rounded-full text-[0.875rem] font-medium ring-1 ring-(--hairline) hover:bg-foreground/5"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!trimmed || !changed || reading}
          className="h-11 flex-1 rounded-full bg-ink text-[0.875rem] font-medium text-pearl transition-opacity disabled:opacity-40 dark:bg-pearl dark:text-ink"
        >
          Save changes
        </button>
      </div>
    </form>
  );
}
