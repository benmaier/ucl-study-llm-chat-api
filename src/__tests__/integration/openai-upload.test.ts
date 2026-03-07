import {
  createOpenAIClient,
  uploadFile,
  executeCodeWithOpenAI,
  executeCodeWithOpenAIStreaming,
  downloadGeneratedFiles,
  deleteFile,
} from "../../modules/openai-client.js";
import type { StreamEvent } from "../../modules/types.js";
import { resolve } from "path";
import { existsSync } from "fs";

const HAS_KEY = !!process.env.OPENAI_API_KEY;
const TEST_CSV_PATH = resolve(process.cwd(), "test-data/sample.csv");
const HAS_CSV = existsSync(TEST_CSV_PATH);

const PLOT_PROMPT = "Read the uploaded CSV file and create a scatter plot of x vs y. Save the plot as plot.png.";

describe.skipIf(!HAS_KEY || !HAS_CSV)("OpenAI file upload + code execution", () => {
  it("should upload, execute, download, and cleanup", async () => {
    const client = createOpenAIClient();

    // Upload
    const uploaded = await uploadFile(client, TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();
    expect(uploaded.filename).toBeTruthy();

    // Execute (non-streaming)
    const result = await executeCodeWithOpenAI(client, PLOT_PROMPT, {
      fileIds: [uploaded.file_id],
    });
    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);

    // Download
    if (result.files.length > 0) {
      const paths = await downloadGeneratedFiles(result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }

    // Cleanup
    await deleteFile(client, uploaded.file_id);
  });

  it("should upload, execute with streaming, download, and cleanup", async () => {
    const client = createOpenAIClient();
    const events: StreamEvent[] = [];

    // Upload
    const uploaded = await uploadFile(client, TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();

    // Execute (streaming)
    const result = await executeCodeWithOpenAIStreaming(
      client,
      PLOT_PROMPT,
      (event) => { events.push(event); },
      { fileIds: [uploaded.file_id] }
    );
    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);
    expect(events.some(e => e.type === "text")).toBe(true);
    expect(events.some(e => e.type === "tool_start")).toBe(true);

    // Download
    if (result.files.length > 0) {
      const paths = await downloadGeneratedFiles(result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }

    // Cleanup
    await deleteFile(client, uploaded.file_id);
  });
});
