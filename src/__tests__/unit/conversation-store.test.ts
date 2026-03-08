import {
  validateSerializedConversation,
  CONVERSATION_FORMAT_VERSION,
  type SerializedConversation,
} from "../../modules/conversation-store.js";

describe("validateSerializedConversation", () => {
  const valid: SerializedConversation = {
    formatVersion: CONVERSATION_FORMAT_VERSION,
    id: "test-123",
    provider: "anthropic",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    uploads: [],
    turns: [],
    textHistory: [],
  };

  it("accepts valid data", () => {
    expect(() => validateSerializedConversation(valid)).not.toThrow();
    const result = validateSerializedConversation(valid);
    expect(result.id).toBe("test-123");
  });

  it("rejects null", () => {
    expect(() => validateSerializedConversation(null)).toThrow("expected an object");
  });

  it("rejects missing formatVersion", () => {
    const { formatVersion, ...rest } = valid;
    expect(() => validateSerializedConversation(rest)).toThrow("formatVersion");
  });

  it("rejects unsupported format version", () => {
    expect(() =>
      validateSerializedConversation({ ...valid, formatVersion: 999 })
    ).toThrow("Unsupported format version");
  });

  it("rejects missing id", () => {
    expect(() =>
      validateSerializedConversation({ ...valid, id: "" })
    ).toThrow("missing id");
  });

  it("rejects invalid provider", () => {
    expect(() =>
      validateSerializedConversation({ ...valid, provider: "grok" })
    ).toThrow("invalid provider");
  });

  it("rejects missing turns array", () => {
    expect(() =>
      validateSerializedConversation({ ...valid, turns: "not-array" })
    ).toThrow("turns must be an array");
  });

  it("rejects missing textHistory array", () => {
    expect(() =>
      validateSerializedConversation({ ...valid, textHistory: null })
    ).toThrow("textHistory must be an array");
  });

  it("rejects missing uploads array", () => {
    expect(() =>
      validateSerializedConversation({ ...valid, uploads: undefined })
    ).toThrow("uploads must be an array");
  });
});
