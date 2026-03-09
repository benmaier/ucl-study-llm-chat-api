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

describe.skipIf(!HAS_ANTHROPIC || !HAS_CSV)("Conversation upload — Anthropic multi-turn fileIds", () => {
  it("should reference uploaded file in a later turn (multi-turn fileIds bug)", async () => {
    const conv = new Conversation({ provider: "anthropic" });

    // Upload file
    const uploaded = await conv.uploadFile(TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();

    // Turn 1: plain message with no file reference — establishes multi-turn state
    await conv.send("Say hello in one sentence.", silentHandler);

    // Turn 2: reference the file in a subsequent turn.
    // Before the fix, executeCodeWithClaudeMultiTurn sent a plain string
    // and never included container_upload blocks, so Claude couldn't see the file.
    const result = await conv.send(
      "Read the uploaded CSV file. What are the column names and how many data rows are there? Be specific.",
      silentHandler,
      { fileIds: [uploaded.file_id] }
    );

    // Claude must actually see the CSV content to answer correctly
    expect(result.text).toMatch(/\bx\b/i);
    expect(result.text).toMatch(/\by\b/i);
    expect(result.text).toMatch(/2/);

    await conv.deleteFile(uploaded.file_id);
  });
});

describe.skipIf(!HAS_OPENAI)("Conversation upload — OpenAI post-tool-call text", () => {
  it("should capture analysis text after code execution (not just pre-tool text)", async () => {
    const conv = new Conversation({ provider: "openai" });
    const events: StreamEvent[] = [];

    // This prompt forces code execution AND a text analysis of the results.
    // Before the fix, only the pre-tool-call text (~150 chars) was returned;
    // the post-tool-call analysis was lost because the streaming function
    // didn't extract text from fullResponse.output messages.
    const result = await conv.send(
      "Use Python to compute the first 10 Fibonacci numbers, then explain what the Fibonacci sequence is and list the numbers you computed.",
      (event) => events.push(event)
    );

    // Must have code execution
    expect(result.codeArtifacts.length).toBeGreaterThan(0);

    // Must have substantial text — not just a short pre-tool intro.
    // Pre-tool text alone would be ~100-200 chars; with analysis it should be much longer.
    expect(result.text.length).toBeGreaterThan(200);

    // The analysis must mention actual Fibonacci numbers from the code output
    expect(result.text).toMatch(/\b(1, 1, 2, 3, 5|1,\s*1,\s*2,\s*3,\s*5|fibonacci)/i);
  });

  it("should capture generated files from code execution", async () => {
    const conv = new Conversation({ provider: "openai" });

    // Ask OpenAI to write a text file via code_interpreter (no heavy deps).
    // Before the fix, files were only captured from text annotations;
    // now they're also extracted from code_interpreter_call results.
    const result = await conv.send(
      "Write a Python script that creates a CSV file called output.csv with columns 'name' and 'score' " +
      "containing 3 rows of sample data. Save it and confirm what you wrote.",
      silentHandler
    );

    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files[0].filename).toBeTruthy();
  }, 60_000);
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
