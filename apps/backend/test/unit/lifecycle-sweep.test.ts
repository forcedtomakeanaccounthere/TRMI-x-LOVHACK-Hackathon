import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [method: string, ...args: unknown[]];
const rpcCalls: Call[] = [];
let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };

const channelCalls: Record<string, { event: string; payload: unknown }[]> = {};
let removeChannelCalls: string[] = [];

vi.mock("../../src/lib/supabase", () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push([fn, args]);
      return rpcResult;
    },
    channel: (name: string) => ({
      send: async (msg: { type: string; event: string; payload: unknown }) => {
        (channelCalls[name] ??= []).push({ event: msg.event, payload: msg.payload });
        return "ok";
      },
    }),
    removeChannel: async (_chan: unknown) => {
      removeChannelCalls.push("removed");
    },
  }),
}));

const { runLifecycleSweep } = await import("../../src/services/lifecycle");

beforeEach(() => {
  rpcCalls.length = 0;
  for (const k of Object.keys(channelCalls)) delete channelCalls[k];
  removeChannelCalls = [];
  rpcResult = { data: [], error: null };
});

describe("runLifecycleSweep", () => {
  it("calls sweep_room_lifecycle RPC and returns empty array if no rooms changed", async () => {
    rpcResult = { data: [], error: null };

    const result = await runLifecycleSweep();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.[0]).toBe("sweep_room_lifecycle");
    expect(result).toEqual([]);
    expect(Object.keys(channelCalls)).toHaveLength(0);
  });

  it("broadcasts status changes to respective room channels when rooms transition", async () => {
    rpcResult = {
      data: [
        {
          room_id: "empty123",
          old_status: "running",
          new_status: "paused",
          transition_reason: "empty_30m",
        },
        {
          room_id: "idle4567",
          old_status: "running",
          new_status: "paused",
          transition_reason: "idle_2h",
        },
        {
          room_id: "arch7890",
          old_status: "paused",
          new_status: "archived",
          transition_reason: "archived_10d_inactive",
        },
      ],
      error: null,
    };

    const result = await runLifecycleSweep();

    expect(result).toHaveLength(3);
    expect(result[0]?.transition_reason).toBe("empty_30m");
    expect(result[1]?.transition_reason).toBe("idle_2h");
    expect(result[2]?.transition_reason).toBe("archived_10d_inactive");

    // Channels broadcast
    expect(channelCalls["room:empty123"]).toEqual([
      { event: "status", payload: { id: "empty123", status: "paused", reason: "empty_30m" } },
    ]);
    expect(channelCalls["room:idle4567"]).toEqual([
      { event: "status", payload: { id: "idle4567", status: "paused", reason: "idle_2h" } },
    ]);
    expect(channelCalls["room:arch7890"]).toEqual([
      { event: "status", payload: { id: "arch7890", status: "archived", reason: "archived_10d_inactive" } },
    ]);

    expect(removeChannelCalls).toHaveLength(3);
  });

  it("throws if the RPC returns an error", async () => {
    rpcResult = { data: null, error: new Error("Database connection lost") };

    await expect(runLifecycleSweep()).rejects.toThrow("Database connection lost");
  });
});
