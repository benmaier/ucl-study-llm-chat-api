import {
  createAnthropicClient,
  executeCodeWithClaudeStreaming,
  downloadGeneratedFiles,
} from "../../modules/anthropic-client.js";
import type { StreamEvent } from "../../modules/types.js";

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

const TEST_PROMPT = `
Plot the function f(x) = (x-1)^3 - exp(-x) - 5 and compute all its zeros.
Requirements:
1. Plot over a suitable range that captures all zeros
2. Use numerical methods to find ALL zeros
3. Mark zeros on the plot with red dots
4. Save the plot as 'function_plot.png'
Show me the computed zeros and the saved plot file.
`;

describe.skipIf(!HAS_KEY)("Anthropic streaming code execution", () => {
  it("should return text, code artifacts, and files", async () => {
    const client = createAnthropicClient();
    const events: StreamEvent[] = [];
    const handler = (event: StreamEvent) => { events.push(event); };

    const result = await executeCodeWithClaudeStreaming(client, TEST_PROMPT, handler);

    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);
    expect(result.files.length).toBeGreaterThan(0);

    // Verify streaming events were emitted
    expect(events.some(e => e.type === "text")).toBe(true);
    expect(events.some(e => e.type === "tool_start")).toBe(true);
    expect(events.some(e => e.type === "tool_end")).toBe(true);

    // Verify code streams incrementally (multiple tool_input deltas)
    const codeEvents = events.filter(e => e.type === "tool_input");
    expect(codeEvents.length).toBeGreaterThan(1);
  });

  it("should emit code_output events with execution results", async () => {
    const client = createAnthropicClient();
    const events: StreamEvent[] = [];
    const handler = (event: StreamEvent) => { events.push(event); };

    // Simple prompt that produces deterministic stdout
    await executeCodeWithClaudeStreaming(
      client,
      "Write a Python script that prints 'HELLO_WORLD_42' and run it. Nothing else.",
      handler
    );

    // Before the fix, no code_output events were emitted for Anthropic.
    // Now bash_code_execution_tool_result text items are emitted as code_output.
    const outputEvents = events.filter(e => e.type === "code_output");
    expect(outputEvents.length).toBeGreaterThan(0);
    expect(outputEvents.some(e => e.output?.includes("HELLO_WORLD_42"))).toBe(true);
  });

  it("should download generated files", async () => {
    const client = createAnthropicClient();
    const handler = () => {};

    const result = await executeCodeWithClaudeStreaming(client, TEST_PROMPT, handler);

    if (result.files.length > 0) {
      const paths = await downloadGeneratedFiles(client, result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }
  });
});
