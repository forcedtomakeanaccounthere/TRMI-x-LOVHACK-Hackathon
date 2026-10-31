import type {
  AuthSession,
  AuthUser,
  CreateLinkRoomRequest,
  CreateRoomResponse,
  CreateTextRoomRequest,
  DashboardQuery,
  DashboardResponse,
  LoginRequest,
  MessageResponse,
  RecapData,
  RoomStatus,
  RoomStatusResponse,
  SignupRequest,
} from "@linkroom/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

    resendVerification: (email: string) =>
      request<MessageResponse>("/api/auth/resend-verification", json({ email })),

    refresh: (refresh_token: string) =>
      request<AuthSession>("/api/auth/refresh", json({ refresh_token })),

    me: (token: string) => request<AuthUser>("/api/auth/me", { method: "GET" }, token),

    // 204 on success; rejects if the backend could not revoke the session, so callers can retry.
    logout: (token: string) =>
      request<unknown>("/api/auth/logout", { method: "POST" }, token).then(() => undefined),
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

  recap: (roomId: string) => request<RecapData>(`/api/rooms/${roomId}/recap`, { method: "POST" }),

  // Dashboard: rooms I created or joined. Deleted rooms come back only when asked for by status.
  myRooms: (query: Partial<DashboardQuery>, token: string) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    return request<DashboardResponse>(`/api/rooms/mine?${params}`, { method: "GET" }, token);
  },

  // Remembers the room for a signed-in user; 404 when it doesn't exist or was deleted.
  joinRoom: (roomId: string, token: string) =>
    request<RoomStatusResponse>(`/api/rooms/${encodeURIComponent(roomId)}/join`, { method: "POST" }, token),

  // Owner only: close, reopen, archive, delete or restore. 409 when another change won the race.
  setRoomStatus: (roomId: string, status: RoomStatus, token: string) =>
    request<RoomStatusResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/status`,
      { ...json({ status }), method: "PATCH" },
      token,
    ),
};
