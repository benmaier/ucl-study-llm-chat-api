/**
 * Tests that Conversation awaits writer notifications before returning.
 *
 * Previously, writer calls were fire-and-forget, which caused data loss
 * on serverless platforms (Vercel) where the function terminates after
 * returning the HTTP response.
 */

import { describe, it, expect, vi } from "vitest";
import { Conversation } from "../../modules/conversation.js";
import { ConversationWriter } from "../../modules/conversation-writer.js";
import type { SerializedConversation, TurnRecord, UploadRecord } from "../../modules/conversation-store.js";

/** A test writer that tracks call order via a shared log array. */
class TrackingWriter extends ConversationWriter {
  log: string[];
  delay: number;

  constructor(log: string[], delay = 50) {
    super();
    this.log = log;
    this.delay = delay;
  }

  async onConversationStart(_conv: SerializedConversation): Promise<void> {
    await new Promise((r) => setTimeout(r, this.delay));
    this.log.push("start");
  }

  async onTurnComplete(
    _id: string,
    turn: TurnRecord,
    conv: SerializedConversation,
  ): Promise<void> {
    await new Promise((r) => setTimeout(r, this.delay));
    this.log.push(`turn:${turn.turnNumber}:turns=${conv.turns.length}`);
  }

  async onFileUploaded(
    _id: string,
    upload: UploadRecord,
  ): Promise<void> {
    await new Promise((r) => setTimeout(r, this.delay));
    this.log.push(`upload:${upload.filename}`);
  }
}

/** A writer that throws to verify errors don't crash the conversation. */
class FailingWriter extends ConversationWriter {
  async onConversationStart(): Promise<void> {
    throw new Error("start failed");
  }
  async onTurnComplete(): Promise<void> {
    throw new Error("turn failed");
  }
  async onFileUploaded(): Promise<void> {
    throw new Error("upload failed");
  }
}

// Mock the provider clients so we don't make real API calls
vi.mock("../../modules/anthropic-client.js", () => ({
  createAnthropicClient: () => ({}),
  executeCodeWithClaudeMultiTurn: vi.fn().mockResolvedValue({
    text: "Hello!",
    files: [],
    codeArtifacts: [],
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
    ],
    containerId: undefined,
  }),
  uploadFileFromBuffer: vi.fn().mockResolvedValue({
    file_id: "file_123",
    filename: "test.csv",
    mime_type: "text/csv",
    size_bytes: 100,
  }),
  downloadGeneratedFiles: vi.fn().mockResolvedValue([]),
  downloadFileToBuffer: vi.fn(),
}));

describe("Conversation writer await", () => {
  it("onTurnComplete is awaited before send() returns", async () => {
    const log: string[] = [];
    const writer = new TrackingWriter(log, 50);

    const conv = new Conversation({
      provider: "anthropic",
      writers: [writer],
    });

    // Wait for onConversationStart to complete
    await new Promise((r) => setTimeout(r, 100));
    expect(log).toContain("start");

    // send() should await onTurnComplete
    await conv.send("hi", () => {});

    // If onTurnComplete was fire-and-forget, this would fail because
    // the async writer (50ms delay) wouldn't have finished yet
    expect(log).toContain("turn:1:turns=1");
  });

  it("onTurnComplete receives correct turn count after multiple turns", async () => {
    const log: string[] = [];
    const writer = new TrackingWriter(log, 10);

    const conv = new Conversation({
      provider: "anthropic",
      writers: [writer],
    });
    await new Promise((r) => setTimeout(r, 50));

    await conv.send("first", () => {});
    await conv.send("second", () => {});

    expect(log).toContain("turn:1:turns=1");
    expect(log).toContain("turn:2:turns=2");
  });

  it("failing writer does not crash send()", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const conv = new Conversation({
      provider: "anthropic",
      writers: [new FailingWriter()],
    });
    await new Promise((r) => setTimeout(r, 50));

    // Should not throw
    const result = await conv.send("hi", () => {});
    expect(result.text).toBe("Hello!");

    consoleSpy.mockRestore();
  });

  it("multiple writers are all awaited", async () => {
    const log: string[] = [];
    const writer1 = new TrackingWriter(log, 30);
    const writer2 = new TrackingWriter(log, 60);

    const conv = new Conversation({
      provider: "anthropic",
      writers: [writer1, writer2],
    });
    await new Promise((r) => setTimeout(r, 100));

    await conv.send("hi", () => {});

    // Both writers should have completed (the slower one takes 60ms)
    const turnEntries = log.filter((l) => l.startsWith("turn:"));
    expect(turnEntries).toHaveLength(2);
  });
});
