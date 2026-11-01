import { LostThread } from "@/components/fx/lost-thread";

// Shown when /r/[id] calls notFound(): the room never existed, was deleted, or the code is mistyped.
export default function RoomNotFound() {
  return (
    <LostThread
      eyebrow="Room not found"
      title={
        <>
          This room has <span className="italic text-royal-gradient">come undone</span>
        </>
      }
      body="It may have been deleted by its owner, or the link is missing a character. Check the code, or start a new room from home."
    />
  );
}
