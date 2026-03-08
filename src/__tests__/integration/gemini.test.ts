import {
  createGeminiClient,
  executeCodeWithGeminiStreaming,
  downloadGeneratedFiles,
} from "../../modules/gemini-client.js";
import type { StreamEvent } from "../../modules/types.js";

const HAS_KEY = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

const TEST_PROMPT = `
Plot the function f(x) = (x-1)^3 - exp(-x) - 5 and compute all its zeros.
Requirements:
1. Plot over a suitable range that captures all zeros
2. Use numerical methods to find ALL zeros
3. Mark zeros on the plot with red dots
4. Save the plot as 'function_plot.png'
Show me the computed zeros and the saved plot file.
`;

describe.skipIf(!HAS_KEY)("Gemini streaming code execution", () => {
  it("should return text, code artifacts, and files", async () => {
    const client = createGeminiClient();
    const events: StreamEvent[] = [];
    const handler = (event: StreamEvent) => { events.push(event); };

    const result = await executeCodeWithGeminiStreaming(client, TEST_PROMPT, handler);

    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);
    // Gemini returns inline base64 images
    expect(result.files.length).toBeGreaterThan(0);

    // Verify streaming events
    expect(events.some(e => e.type === "text")).toBe(true);
    expect(events.some(e => e.type === "tool_start")).toBe(true);
    expect(events.some(e => e.type === "tool_end")).toBe(true);

    // Verify code events emitted (Gemini sends complete blocks, not deltas)
    const codeEvents = events.filter(e => e.type === "code");
    expect(codeEvents.length).toBeGreaterThan(0);
  });

  it("should download base64 files to disk", async () => {
    const client = createGeminiClient();
    const handler = () => {};

    const result = await executeCodeWithGeminiStreaming(client, TEST_PROMPT, handler);

    if (result.files.length > 0) {
      const paths = await downloadGeneratedFiles(result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }
  });
});
