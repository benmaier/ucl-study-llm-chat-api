import { Conversation } from "../../modules/conversation.js";
import type { StreamEvent } from "../../modules/types.js";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";

const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY;
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
const HAS_GEMINI = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
const TEST_CSV_PATH = resolve(process.cwd(), "test-data/sample.csv");
const HAS_CSV = existsSync(TEST_CSV_PATH);

const PLOT_PROMPT = "Read the uploaded CSV file and create a scatter plot of x vs y. Save the plot as plot.png.";
const silentHandler = (_event: StreamEvent) => {};

describe.skipIf(!HAS_ANTHROPIC || !HAS_CSV)("Conversation upload — Anthropic", () => {
  it("should upload, send with fileIds, download, and delete", async () => {
    const conv = new Conversation({ provider: "anthropic" });

    const uploaded = await conv.uploadFile(TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();
    expect(uploaded.filename).toBeTruthy();

    const result = await conv.send(PLOT_PROMPT, silentHandler, {
      fileIds: [uploaded.file_id],
    });
    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);

    if (result.files.length > 0) {
      const paths = await conv.downloadFiles(result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }

    await conv.deleteFile(uploaded.file_id);
  });

  it("should upload from buffer", async () => {
    const conv = new Conversation({ provider: "anthropic" });
    const buffer = readFileSync(TEST_CSV_PATH);

    const uploaded = await conv.uploadFileFromBuffer(buffer, "test.csv");
    expect(uploaded.file_id).toBeTruthy();

    await conv.deleteFile(uploaded.file_id);
  });
});

describe.skipIf(!HAS_OPENAI || !HAS_CSV)("Conversation upload — OpenAI", () => {
  it("should upload, send with fileIds, download, and delete", async () => {
    const conv = new Conversation({ provider: "openai" });

    const uploaded = await conv.uploadFile(TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();
    expect(uploaded.filename).toBeTruthy();

    const result = await conv.send(PLOT_PROMPT, silentHandler, {
      fileIds: [uploaded.file_id],
    });
    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);

    if (result.files.length > 0) {
      const paths = await conv.downloadFiles(result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }

    await conv.deleteFile(uploaded.file_id);
  });

  it("should upload from buffer", async () => {
    const conv = new Conversation({ provider: "openai" });
    const buffer = readFileSync(TEST_CSV_PATH);

    const uploaded = await conv.uploadFileFromBuffer(buffer, "test.csv");
    expect(uploaded.file_id).toBeTruthy();

    await conv.deleteFile(uploaded.file_id);
  });
});

describe.skipIf(!HAS_GEMINI || !HAS_CSV)("Conversation upload — Gemini", () => {
  it("should upload, send with fileIds, download, and delete", async () => {
    const conv = new Conversation({ provider: "gemini" });

    const uploaded = await conv.uploadFile(TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();
    expect(uploaded.filename).toBeTruthy();

    const result = await conv.send(PLOT_PROMPT, silentHandler, {
      fileIds: [uploaded.file_id],
    });
    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);

    if (result.files.length > 0) {
      const paths = await conv.downloadFiles(result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }

    await conv.deleteFile(uploaded.file_id);
  });

  it("should upload from buffer", async () => {
    const conv = new Conversation({ provider: "gemini" });
    const buffer = readFileSync(TEST_CSV_PATH);

    const uploaded = await conv.uploadFileFromBuffer(buffer, "test.csv");
    expect(uploaded.file_id).toBeTruthy();

    await conv.deleteFile(uploaded.file_id);
  });
});
