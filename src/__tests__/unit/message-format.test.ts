/**
 * Unit tests for message-format.ts — converting stored TurnRecords
 * back into UnifiedMessage arrays for the frontend.
 */

import { describe, it, expect } from "vitest";
import {
  convertTurnsToMessages,
  convertTurnToMessages,
  type UnifiedToolCallPart,
  type UnifiedTextPart,
} from "../../modules/message-format.js";
import type { TurnRecord } from "../../modules/conversation-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal TurnRecord factory with sensible defaults. */
function makeTurn(overrides: Partial<TurnRecord> & { turnNumber: number }): TurnRecord {
  return {
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    userMessage: "test prompt",
    attachedFileIds: [],
    assistantText: "",
    codeArtifacts: [],
    generatedFiles: [],
    provider: "openai",
    providerStateAfter: {},
    ...overrides,
  } as TurnRecord;
}

// ---------------------------------------------------------------------------
// OpenAI: buildPartsFromOpenAI
// ---------------------------------------------------------------------------

describe("buildPartsFromOpenAI", () => {
  it("extracts tool output from outputs field (plural)", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "openai",
      assistantText: "The factorial is 3628800.",
      codeArtifacts: [
        { id: "ci_1", path: "code_interpreter", code: "print(3628800)", language: "python" },
      ],
      providerStateAfter: {
        openaiOutput: [
          {
            id: "ci_1",
            type: "code_interpreter_call",
            status: "completed",
            code: "print(3628800)",
            outputs: [{ type: "logs", logs: "3628800" }],
          },
          {
            id: "msg_1",
            type: "message",
            content: [{ type: "output_text", text: "The factorial is 3628800." }],
          },
        ],
      },
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    const toolPart = assistant.parts.find((p) => p.type === "tool-call") as UnifiedToolCallPart;

    expect(toolPart).toBeDefined();
    expect(toolPart.output).toBe("3628800");
    expect(toolPart.input).toEqual({ code: "print(3628800)" });
  });

  it("handles 2 tool calls with outputs", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "openai",
      providerStateAfter: {
        openaiOutput: [
          {
            id: "ci_1",
            type: "code_interpreter_call",
            status: "completed",
            code: "factorial = 1\nfor i in range(1,11): factorial *= i\nfactorial",
            outputs: [{ type: "logs", logs: "3628800" }],
          },
          {
            id: "ci_2",
            type: "code_interpreter_call",
            status: "completed",
            code: "fib = [0,1]\nfor i in range(13): fib.append(fib[-1]+fib[-2])\nfib",
            outputs: [{ type: "logs", logs: "[0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377]" }],
          },
          {
            id: "msg_1",
            type: "message",
            content: [{ type: "output_text", text: "Both computations complete." }],
          },
        ],
      },
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    const tools = assistant.parts.filter((p) => p.type === "tool-call") as UnifiedToolCallPart[];
    const texts = assistant.parts.filter((p) => p.type === "text") as UnifiedTextPart[];

    expect(tools).toHaveLength(2);
    expect(tools[0].output).toBe("3628800");
    expect(tools[0].toolCallId).toBe("tool-1-0");
    expect(tools[1].output).toContain("0, 1, 1, 2, 3");
    expect(tools[1].toolCallId).toBe("tool-1-1");

    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe("Both computations complete.");
  });

  it("handles text before tool calls (interleaved)", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "openai",
      providerStateAfter: {
        openaiOutput: [
          {
            id: "msg_1",
            type: "message",
            content: [{ type: "output_text", text: "Let me calculate." }],
          },
          {
            id: "ci_1",
            type: "code_interpreter_call",
            status: "completed",
            code: "print(42)",
            outputs: [{ type: "logs", logs: "42" }],
          },
        ],
      },
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;

    expect(assistant.parts[0]).toMatchObject({ type: "text", text: "Let me calculate." });
    expect(assistant.parts[1]).toMatchObject({ type: "tool-call", output: "42" });
  });

  it("handles tool with no output (empty outputs array)", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "openai",
      providerStateAfter: {
        openaiOutput: [
          {
            id: "ci_1",
            type: "code_interpreter_call",
            status: "completed",
            code: "x = 1",
            outputs: [],
          },
        ],
      },
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    const tool = assistant.parts.find((p) => p.type === "tool-call") as UnifiedToolCallPart;

    expect(tool.output).toBeNull();
  });

  it("handles tool with missing outputs field entirely", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "openai",
      providerStateAfter: {
        openaiOutput: [
          {
            id: "ci_1",
            type: "code_interpreter_call",
            status: "completed",
            code: "x = 1",
            // no outputs field at all
          },
        ],
      },
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    const tool = assistant.parts.find((p) => p.type === "tool-call") as UnifiedToolCallPart;

    expect(tool.output).toBeNull();
  });

  it("handles 3 tool calls, all with outputs", () => {
    const turn = makeTurn({
      turnNumber: 2,
      provider: "openai",
      providerStateAfter: {
        openaiOutput: [
          {
            id: "ci_1",
            type: "code_interpreter_call",
            status: "completed",
            code: "print('A')",
            outputs: [{ type: "logs", logs: "A" }],
          },
          {
            id: "ci_2",
            type: "code_interpreter_call",
            status: "completed",
            code: "print('B')",
            outputs: [{ type: "logs", logs: "B" }],
          },
          {
            id: "ci_3",
            type: "code_interpreter_call",
            status: "completed",
            code: "print('C')",
            outputs: [{ type: "logs", logs: "C" }],
          },
          {
            id: "msg_1",
            type: "message",
            content: [{ type: "output_text", text: "Done." }],
          },
        ],
      },
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    const tools = assistant.parts.filter((p) => p.type === "tool-call") as UnifiedToolCallPart[];

    expect(tools).toHaveLength(3);
    expect(tools[0]).toMatchObject({ toolCallId: "tool-2-0", output: "A" });
    expect(tools[1]).toMatchObject({ toolCallId: "tool-2-1", output: "B" });
    expect(tools[2]).toMatchObject({ toolCallId: "tool-2-2", output: "C" });
  });

  it("concatenates multiple log entries in outputs", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "openai",
      providerStateAfter: {
        openaiOutput: [
          {
            id: "ci_1",
            type: "code_interpreter_call",
            status: "completed",
            code: "print('line1'); print('line2')",
            outputs: [
              { type: "logs", logs: "line1" },
              { type: "logs", logs: "line2" },
            ],
          },
        ],
      },
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    const tool = assistant.parts.find((p) => p.type === "tool-call") as UnifiedToolCallPart;

    expect(tool.output).toBe("line1\nline2");
  });
});

// ---------------------------------------------------------------------------
// Fallback: buildPartsFallback
// ---------------------------------------------------------------------------

describe("buildPartsFallback", () => {
  it("uses fallback when no provider state", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "openai",
      assistantText: "Hello world",
      providerStateAfter: {},
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;

    expect(assistant.parts).toHaveLength(1);
    expect(assistant.parts[0]).toMatchObject({ type: "text", text: "Hello world" });
  });

  it("fallback includes code artifacts without output", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "openai",
      assistantText: "Result:",
      codeArtifacts: [
        { id: "a1", path: "code_interpreter", code: "print(1)", language: "python" },
      ],
      providerStateAfter: {},
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;

    expect(assistant.parts).toHaveLength(2);
    expect(assistant.parts[0]).toMatchObject({ type: "text" });
    const tool = assistant.parts[1] as UnifiedToolCallPart;
    expect(tool.type).toBe("tool-call");
    expect(tool.input).toEqual({ code: "print(1)" });
    expect(tool.output).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// convertTurnsToMessages: multi-turn
// ---------------------------------------------------------------------------

describe("convertTurnsToMessages", () => {
  it("produces user + assistant pair per turn", () => {
    const turns = [
      makeTurn({ turnNumber: 1, userMessage: "Hi", assistantText: "Hello" }),
      makeTurn({ turnNumber: 2, userMessage: "Bye", assistantText: "Goodbye" }),
    ];

    const msgs = convertTurnsToMessages(turns);

    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[2].role).toBe("user");
    expect(msgs[3].role).toBe("assistant");
  });

  it("assigns stable IDs based on turn number", () => {
    const turns = [makeTurn({ turnNumber: 3 })];
    const msgs = convertTurnsToMessages(turns);

    expect(msgs[0].id).toBe("user-3");
    expect(msgs[1].id).toBe("assistant-3");
  });

  it("strips attached-files prefix from user message", () => {
    const turns = [
      makeTurn({
        turnNumber: 1,
        userMessage: '[Attached files:\n  input_file_0: "data.csv"]\n\nAnalyze this data',
      }),
    ];

    const msgs = convertTurnsToMessages(turns);
    const userParts = msgs[0].parts.filter((p) => p.type === "text") as UnifiedTextPart[];

    expect(userParts[0].text).toBe("Analyze this data");
  });
});

// ---------------------------------------------------------------------------
// Claude: buildPartsFromClaude
// ---------------------------------------------------------------------------

describe("buildPartsFromClaude", () => {
  it("extracts tool call with output from Claude messages", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "anthropic",
      providerStateAfter: {
        claudeMessages: [
          {
            role: "assistant",
            content: [
              { type: "text", text: "Let me run that." },
              {
                type: "server_tool_use",
                id: "toolu_1",
                name: "bash",
                input: { command: "echo hello" },
              },
              {
                type: "bash_code_execution_tool_result",
                tool_use_id: "toolu_1",
                content: {
                  type: "bash_code_execution_result",
                  stdout: "hello",
                },
              },
              { type: "text", text: "Done." },
            ],
          },
        ],
      },
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    const tools = assistant.parts.filter((p) => p.type === "tool-call") as UnifiedToolCallPart[];
    const texts = assistant.parts.filter((p) => p.type === "text") as UnifiedTextPart[];

    expect(tools).toHaveLength(1);
    expect(tools[0].output).toBe("hello");
    expect(tools[0].input).toEqual({ code: "echo hello" });
    expect(texts).toHaveLength(2);
    expect(texts[0].text).toBe("Let me run that.");
    expect(texts[1].text).toBe("Done.");
  });
});

// ---------------------------------------------------------------------------
// Gemini: buildPartsFromGemini
// ---------------------------------------------------------------------------

describe("buildPartsFromGemini", () => {
  it("extracts tool call with output from Gemini contents", () => {
    const turn = makeTurn({
      turnNumber: 1,
      provider: "gemini",
      providerStateAfter: {
        geminiContents: [
          {
            role: "model",
            parts: [
              { text: "Computing..." },
              { executableCode: { code: "print(42)" } },
              { codeExecutionResult: { output: "42" } },
              { text: "The answer is 42." },
            ],
          },
        ],
      },
    });

    const msgs = convertTurnToMessages(turn);
    const assistant = msgs.find((m) => m.role === "assistant")!;
    const tools = assistant.parts.filter((p) => p.type === "tool-call") as UnifiedToolCallPart[];
    const texts = assistant.parts.filter((p) => p.type === "text") as UnifiedTextPart[];

    expect(tools).toHaveLength(1);
    expect(tools[0].output).toBe("42");
    expect(tools[0].input).toEqual({ code: "print(42)" });
    expect(texts).toHaveLength(2);
  });
});
