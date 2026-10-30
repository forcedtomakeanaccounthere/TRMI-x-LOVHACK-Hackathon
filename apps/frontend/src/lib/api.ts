import type {
  AuthSession,
  AuthUser,
  CreateLinkRoomRequest,
  CreateRoomResponse,
  CreateTextRoomRequest,
  LoginRequest,
  MessageResponse,
  RecapData,
  SignupRequest,
} from "@linkroom/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Pass the access token from AuthSession for routes that need a logged-in user.
async function request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
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
};
