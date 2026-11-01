import type {
  AiMessage,
  AuthSession,
  AuthUser,
  CreateLinkRoomRequest,
  CreateRoomResponse,
  CreateStudyRequest,
  CreateTextRoomRequest,
  DashboardQuery,
  DashboardResponse,
  FollowStateResponse,
  ExportSummaryQuery,
  LoginRequest,
  MessageResponse,
  ParticipantsResponse,
  Profile,
  RecapData,
  RoomDetail,
  RoomStatusResponse,
  SignupRequest,
  StudySet,
  StudySetsResponse,
  StudySourcesResponse,
  UsersResponse,
  MentionAck,
  MentionablesResponse,
  MentionNotifyRequest,
  NotificationsResponse,
  PushKeyResponse,
  PushSubscribeRequest,
  UpdateRoomRequest,
} from "@linkroom/shared";

// What the room workspace asks the AI: the question plus the documents, passage, snapshot and recent
// turns it is about. components/room/ai.ts turns this into calls to POST /api/rooms/:id/ask, one per
// document, with the passage, turns and snapshot as their own fields.
export type AskRequest = {
  question: string;
  sources: string[]; // room ids of the documents to answer from
  quote?: string | null; // the selected text an AI box was opened on
  image?: string | null; // a lens snapshot as a JPEG data URL
  history?: { role: "user" | "ai"; text: string }[];
  name?: string; // shown as "asked by"
};

// The public URL of the backend, e.g. https://link-room-api.onrender.com. NEXT_PUBLIC_ vars are
// inlined into the browser bundle when `next build` runs, so this must be set in the deploy
// environment *before* the build (docs/LOCAL_SETUP.md "Deploying"). Errors here show up in the
// browser as requests to localhost — the fallback below — with a CORS / net::ERR_FAILED message.
export function resolveApiUrl(raw: string | undefined): string {
  const value = raw?.trim().replace(/\/+$/, "");
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    console.warn("[api] NEXT_PUBLIC_API_URL is not set; falling back to http://localhost:4000");
  }
  return "http://localhost:4000";
}

export const API_URL = resolveApiUrl(process.env.NEXT_PUBLIC_API_URL);

// Carries the HTTP status so callers can branch, e.g. 403 = email not verified on login.
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Pass the access token from AuthSession for routes that need a logged-in user.
async function request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

const json = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export const api = {
  auth: {
    signup: (data: SignupRequest) => request<MessageResponse>("/api/auth/signup", json(data)),

    login: (data: LoginRequest) => request<AuthSession>("/api/auth/login", json(data)),

    resendVerification: (email: string) => request<MessageResponse>("/api/auth/resend-verification", json({ email })),

    // Proposed (CHECKLIST.md "Auth: password reset"): emails a link to /forgot-password?token_hash=…
    forgotPassword: (email: string) => request<MessageResponse>("/api/auth/forgot-password", json({ email })),

    // Proposed: uses the emailed link's token once and sets the new password.
    resetPassword: (data: { token_hash: string; password: string }) =>
      request<MessageResponse>("/api/auth/reset-password", json(data)),

    refresh: (refresh_token: string) => request<AuthSession>("/api/auth/refresh", json({ refresh_token })),

    me: (token: string) => request<AuthUser>("/api/auth/me", { method: "GET" }, token),

    // 204 on success; rejects if the backend could not revoke the session, so callers can retry.
    logout: (token: string) => request<unknown>("/api/auth/logout", { method: "POST" }, token).then(() => undefined),
  },

  createLinkRoom: (data: CreateLinkRoomRequest, token: string) =>
    request<CreateRoomResponse>("/api/rooms/link", json(data), token),

  createTextRoom: (data: CreateTextRoomRequest, token: string) =>
    request<CreateRoomResponse>("/api/rooms/text", json(data), token),

  createPdfRoom: (file: File, token: string) => {
    const form = new FormData();
    form.append("file", file);
    return request<CreateRoomResponse>("/api/rooms/pdf", { method: "POST", body: form }, token);
  },

  // PDF, DOCX, PPTX, Markdown or text; the backend detects the format from the bytes.
  createFileRoom: (file: File, token: string) => {
    const form = new FormData();
    form.append("file", file);
    return request<CreateRoomResponse>("/api/rooms/file", { method: "POST", body: form }, token);
  },

  // Proposed (CHECKLIST.md "Link rooms workspace"): turns a video's transcript into t{n} blocks.
  // `transcript`: pasted by the creator when the captions can't be fetched (a 422 says so).
  createYoutubeRoom: (url: string, token: string, transcript?: string) =>
    request<CreateRoomResponse>("/api/rooms/youtube", json(transcript ? { url, transcript } : { url }), token),

  // Answers a question about one room's document, with citations into its blocks.
  ask: (
    roomId: string,
    body: {
      question: string;
      name?: string;
      quote?: string;
      history?: { role: "user" | "ai"; text: string }[];
      image?: string;
    },
  ) => request<AiMessage>(`/api/rooms/${encodeURIComponent(roomId)}/ask`, json(body)),

  // Proposed: a summary, quiz, flashcards, mind map or infographic from the chosen documents.
  // Attaches another document (room) to a room, so AI requests on the room may use it. Attaching
  // one that's already there changes nothing.
  attachSource: (roomId: string, sourceRoomId: string, token: string) =>
    request<unknown>(`/api/rooms/${encodeURIComponent(roomId)}/sources`, json({ source_room_id: sourceRoomId }), token),

  // With the signed-in person's token, so sources only members can read are in scope.
  generateArtifact: (roomId: string, body: { kind: string; sources: string[] }, token?: string) =>
    request<unknown>(`/api/rooms/${encodeURIComponent(roomId)}/artifacts`, json(body), token),

  // `name` is shown as "Recapped by …". 422 = nothing highlighted yet, 429 = wait (Retry-After),
  // 409 = a recap is already on its way.
  recap: (roomId: string, name?: string) => request<RecapData>(`/api/rooms/${roomId}/recap`, json({ name })),

  // A plain URL (not a fetch) so the browser downloads the file itself.
  summaryExportUrl: (roomId: string, format: ExportSummaryQuery["format"]) =>
    `${API_URL}/api/rooms/${encodeURIComponent(roomId)}/summary/export?format=${format}`,

  // Dashboard: rooms I created or joined. Deleted rooms come back only when asked for by status.
  myRooms: (query: Partial<DashboardQuery>, token: string) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    return request<DashboardResponse>(`/api/me/rooms?${params}`, { method: "GET" }, token);
  },

  // Remembers the room for a signed-in user; 404 when it doesn't exist or was deleted.
  joinRoom: (roomId: string, token: string) =>
    request<RoomStatusResponse>(`/api/rooms/${encodeURIComponent(roomId)}/join`, { method: "POST" }, token),

  // Records reader presence heartbeat (both signed-in and guest readers) without updating activity timer.
  heartbeat: (roomId: string, token?: string) =>
    request<RoomStatusResponse>(`/api/rooms/${encodeURIComponent(roomId)}/heartbeat`, { method: "POST" }, token),

  // Records user activity (keystrokes, mouse events, scroll) to keep the room running.
  recordActivity: (roomId: string, token?: string) =>
    request<RoomStatusResponse>(`/api/rooms/${encodeURIComponent(roomId)}/activity`, { method: "POST" }, token),

  // Owner only. 409 when the room is deleted (restore it first) or another change won the race.
  updateRoom: (roomId: string, data: UpdateRoomRequest, token: string) =>
    request<RoomDetail>(`/api/rooms/${encodeURIComponent(roomId)}`, { ...json(data), method: "PATCH" }, token),

  // Owner only: soft delete. A deleted room stays restorable.
  deleteRoom: (roomId: string, token: string) =>
    request<RoomDetail>(`/api/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" }, token),

  // Owner only: brings a deleted room back as running.
  restoreRoom: (roomId: string, token: string) =>
    request<RoomDetail>(`/api/rooms/${encodeURIComponent(roomId)}/restore`, { method: "POST" }, token),

  // Study tools: quiz, flashcards, mind map or infographic from the documents the user picks.
  // The signed-in user: profile, who they follow and who follows them, and people they've read with.
  me: {
    profile: (token: string) => request<Profile>("/api/me/profile", { method: "GET" }, token),
    following: (token: string) => request<UsersResponse>("/api/me/following", { method: "GET" }, token),
    followers: (token: string) => request<UsersResponse>("/api/me/followers", { method: "GET" }, token),
    participants: (token: string) => request<ParticipantsResponse>("/api/me/participants", { method: "GET" }, token),
  },

  // Mentions and notifications (apps/backend routes/notifications.ts).
  notifications: {
    // Who can be @mentioned in a room: its owner and every signed-in reader who has opened it.
    people: (roomId: string) =>
      request<MentionablesResponse>(`/api/notifications/rooms/${encodeURIComponent(roomId)}/people`, {
        method: "GET",
      }),
    // Announces the mentions in a message just written to the ledger, so the backend notifies
    // those people (a toast if they're in the room, the bell, email if they're away, push).
    announce: (roomId: string, body: MentionNotifyRequest, token?: string) =>
      request<MentionAck>(`/api/notifications/rooms/${encodeURIComponent(roomId)}/mentions`, json(body), token),
    list: (token: string) => request<NotificationsResponse>("/api/notifications", { method: "GET" }, token),
    // No ids marks everything read.
    markRead: (token: string, ids?: string[]) =>
      request<unknown>("/api/notifications/read", json(ids ? { ids } : {}), token),
    pushKey: (token: string) => request<PushKeyResponse>("/api/notifications/key", { method: "GET" }, token),
    subscribe: (subscription: PushSubscribeRequest, token: string) =>
      request<unknown>("/api/notifications/subscribe", json(subscription), token),
    unsubscribe: (endpoint: string, token: string) =>
      request<unknown>("/api/notifications/unsubscribe", json({ endpoint }), token),
  },

  users: {
    // People on LinkRoom whose name matches, with whether you already follow them.
    search: (q: string, token: string) =>
      request<UsersResponse>(`/api/users/search?q=${encodeURIComponent(q)}&limit=20`, { method: "GET" }, token),
    follow: (id: string, token: string) =>
      request<FollowStateResponse>(`/api/users/${encodeURIComponent(id)}/follow`, { method: "POST" }, token),
    unfollow: (id: string, token: string) =>
      request<FollowStateResponse>(`/api/users/${encodeURIComponent(id)}/follow`, { method: "DELETE" }, token),
  },

  study: {
    // The documents to show in the picker (optionally one project's).
    sources: (token: string, groupId?: string) =>
      request<StudySourcesResponse>(
        `/api/study/sources${groupId ? `?group_id=${encodeURIComponent(groupId)}` : ""}`,
        { method: "GET" },
        token,
      ),

    // Select all: { kind, all: true }. Selective: { kind, room_ids: [...] }.
    // 404 = a document wasn't found, 409 = one is already being made, 422 = no text, 429 = wait.
    create: (data: CreateStudyRequest, token: string) => request<StudySet>("/api/study", json(data), token),

    list: (token: string) => request<StudySetsResponse>("/api/study", { method: "GET" }, token),

    get: (id: string, token: string) => request<StudySet>(`/api/study/${id}`, { method: "GET" }, token),

    remove: (id: string, token: string) =>
      request<unknown>(`/api/study/${id}`, { method: "DELETE" }, token).then(() => undefined),
  },
};
