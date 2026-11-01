import type { Role } from "@linkroom/shared";
import { AccessToken, RoomServiceClient, TrackSource, type VideoGrant } from "livekit-server-sdk";
import { env } from "../env";
import { HttpError } from "../middleware/error";
import { can } from "./ledger";

// Thin wrapper around LiveKit Cloud / Twirp RoomService SDK.
// The only file in the codebase that imports livekit-server-sdk.

export function getLiveKitConfig() {
  const url = process.env.LIVEKIT_URL ?? env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY ?? env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? env.LIVEKIT_API_SECRET;
  return { url, apiKey, apiSecret };
}

export function isLiveKitConfigured(): boolean {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  return Boolean(url && apiKey && apiSecret);
}

function toHttpUrl(url: string): string {
  return url.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
}

function getRoomService(): RoomServiceClient | null {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  if (!url || !apiKey || !apiSecret) return null;
  return new RoomServiceClient(toHttpUrl(url), apiKey, apiSecret);
}

/** Pure grant builder for LiveKit tokens: viewers listen only, editors and above speak. */
export function grantsFor(role: Role, livekitRoom: string): VideoGrant {
  const allowed = can.annotate(role);
  return {
    roomJoin: true,
    room: livekitRoom,
    canSubscribe: true,
    canPublish: allowed,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: allowed,
    canUpdateOwnMetadata: false,
  };
}

/** Mint a LiveKit room token with a 10m TTL. */
export async function mintToken(
  identity: string | { id: string; signedIn?: boolean },
  name: string,
  role: Role,
  livekitRoom: string,
  signedIn?: boolean,
): Promise<string> {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  if (!url || !apiKey || !apiSecret) {
    throw new HttpError(503, "Voice huddles aren't set up");
  }
  const memberId = typeof identity === "string" ? identity : identity.id;
  const isSignedIn = typeof identity === "string" ? Boolean(signedIn) : Boolean(identity.signedIn);

  const at = new AccessToken(apiKey, apiSecret, {
    identity: memberId,
    name,
    ttl: "10m",
    metadata: JSON.stringify({ role, signedIn: isSignedIn }),
  });
  at.addGrant(grantsFor(role, livekitRoom));
  return at.toJwt();
}

/** Disconnect a participant from a LiveKit room. Errors are caught and logged. */
export async function removeFromRoom(livekitRoom: string, identity: string): Promise<void> {
  const client = getRoomService();
  if (!client) return;
  try {
    await client.removeParticipant(livekitRoom, identity);
  } catch (err) {
    console.warn(`[livekit] Failed to remove ${identity} from ${livekitRoom}:`, err);
  }
}

/** Update speaking and data-publishing permissions for a connected participant. */
export async function setPublish(livekitRoom: string, identity: string, canPublish: boolean): Promise<void> {
  const client = getRoomService();
  if (!client) return;
  try {
    await client.updateParticipant(livekitRoom, identity, {
      permission: {
        canPublish,
        canPublishData: canPublish,
        canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
        canSubscribe: true,
      },
    });
  } catch (err) {
    console.warn(`[livekit] Failed to setPublish for ${identity} in ${livekitRoom}:`, err);
  }
}

/** Count participants currently connected in LiveKit. Returns null on failure. */
export async function participantCount(livekitRoom: string): Promise<number | null> {
  const client = getRoomService();
  if (!client) return null;
  try {
    const list = await client.listParticipants(livekitRoom);
    return list.length;
  } catch (err) {
    console.warn(`[livekit] Failed to get participantCount for ${livekitRoom}:`, err);
    return null;
  }
}

/** Delete a room in LiveKit, disconnecting any remaining participants. Errors are caught and logged. */
export async function closeRoom(livekitRoom: string): Promise<void> {
  const client = getRoomService();
  if (!client) return;
  try {
    await client.deleteRoom(livekitRoom);
  } catch (err) {
    console.warn(`[livekit] Failed to closeRoom ${livekitRoom}:`, err);
  }
}
