import {
  createAnthropicClient,
  uploadFile,
  executeCodeWithClaude,
  executeCodeWithClaudeStreaming,
  downloadGeneratedFiles,
  deleteFile,
} from "../../modules/anthropic-client.js";
import type { StreamEvent } from "../../modules/types.js";
import { resolve } from "path";
import { existsSync } from "fs";

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const TEST_CSV_PATH = resolve(process.cwd(), "test-data/sample.csv");
const HAS_CSV = existsSync(TEST_CSV_PATH);

const PLOT_PROMPT = "Read the uploaded CSV file and create a scatter plot of x vs y. Save the plot as plot.png.";

describe.skipIf(!HAS_KEY || !HAS_CSV)("Anthropic file upload + code execution", () => {
  it("should upload, execute, download, and cleanup", async () => {
    const client = createAnthropicClient();

    // Upload
    const uploaded = await uploadFile(client, TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();
    expect(uploaded.filename).toBeTruthy();

    // Execute (non-streaming)
    const result = await executeCodeWithClaude(client, PLOT_PROMPT, {
      fileIds: [uploaded.file_id],
    });
    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);

    // Download
    if (result.files.length > 0) {
      const paths = await downloadGeneratedFiles(client, result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }

    // Cleanup
    await deleteFile(client, uploaded.file_id);
  });

  it("should upload, execute with streaming, download, and cleanup", async () => {
    const client = createAnthropicClient();
    const events: StreamEvent[] = [];

    // Upload
    const uploaded = await uploadFile(client, TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();

    // Execute (streaming)
    const result = await executeCodeWithClaudeStreaming(
      client,
      PLOT_PROMPT,
      (event) => { events.push(event); },
      { fileIds: [uploaded.file_id] }
    );
    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);
    expect(events.some(e => e.type === "text")).toBe(true);
    expect(events.some(e => e.type === "tool_start")).toBe(true);

    // Verify code streams incrementally (multiple tool_input deltas)
    const codeEvents = events.filter(e => e.type === "tool_input");
    expect(codeEvents.length).toBeGreaterThan(1);

    // Download
    if (result.files.length > 0) {
      const paths = await downloadGeneratedFiles(client, result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }

    // Cleanup
    await deleteFile(client, uploaded.file_id);
  });
});
