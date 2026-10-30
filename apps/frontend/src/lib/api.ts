import type {
  CreateLinkRoomRequest,
  CreateRoomResponse,
  CreateTextRoomRequest,
  RecapData,
} from "@linkroom/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
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
  createLinkRoom: (data: CreateLinkRoomRequest) =>
    request<CreateRoomResponse>("/api/rooms/link", json(data)),

  createTextRoom: (data: CreateTextRoomRequest) =>
    request<CreateRoomResponse>("/api/rooms/text", json(data)),

  createPdfRoom: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<CreateRoomResponse>("/api/rooms/pdf", { method: "POST", body: form });
  },

  recap: (roomId: string) => request<RecapData>(`/api/rooms/${roomId}/recap`, { method: "POST" }),
};
