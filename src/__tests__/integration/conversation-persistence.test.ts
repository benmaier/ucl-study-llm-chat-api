import { Conversation } from "../../modules/conversation.js";
import { FileWriter } from "../../modules/file-writer.js";
import { ConversationWriter } from "../../modules/conversation-writer.js";
import type { SerializedConversation, TurnRecord, UploadRecord } from "../../modules/conversation-store.js";
import type { StreamEvent } from "../../modules/types.js";
import { resolve } from "path";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";

const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY;
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
const HAS_GEMINI = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

const silentHandler = (_event: StreamEvent) => {};

// In-memory writer for testing
class TestWriter extends ConversationWriter {
  turns: TurnRecord[] = [];
  uploads: UploadRecord[] = [];
  conversations: SerializedConversation[] = [];

  async onConversationStart(conversation: SerializedConversation) {
    this.conversations.push(conversation);
  }
  async onTurnComplete(_id: string, turn: TurnRecord, conversation: SerializedConversation) {
    this.turns.push(turn);
    this.conversations.push(conversation);
  }
  async onFileUploaded(_id: string, upload: UploadRecord) {
    this.uploads.push(upload);
  }
}

describe.skipIf(!HAS_ANTHROPIC)("Conversation persistence — Anthropic", () => {
  it("should record turns and notify writer", async () => {
    const writer = new TestWriter();
    const conv = new Conversation({
      provider: "anthropic",
      writers: [writer],
    });

    expect(conv.getId()).toBeTruthy();

    await conv.send("What is 2 + 2?", silentHandler);

    // Wait a tick for fire-and-forget writer
    await new Promise(r => setTimeout(r, 100));

    expect(conv.getTurns()).toHaveLength(1);
    expect(conv.getTurns()[0].userMessage).toBe("What is 2 + 2?");
    expect(conv.getTurns()[0].assistantText).toBeTruthy();
    expect(conv.getTurns()[0].turnNumber).toBe(1);
    expect(conv.getTurns()[0].providerStateAfter.claudeMessages).toBeDefined();

    // Writer should have been called: 1 onConversationStart + 1 onTurnComplete
    expect(writer.turns).toHaveLength(1);
    expect(writer.conversations.length).toBeGreaterThanOrEqual(2);
  });

  it("should save to file and resume", async () => {
    const filePath = resolve(tmpdir(), `conv-test-${Date.now()}.json`);
    const fileWriter = new FileWriter(filePath);

    try {
      // Create and send a turn
      const conv1 = new Conversation({
        provider: "anthropic",
        writers: [fileWriter],
        metadata: { experiment: "test" },
      });
      await conv1.send(
        "Write a Python function that returns 42. Just the code, nothing else.",
        silentHandler
      );

      // Wait for file writer
      await new Promise(r => setTimeout(r, 200));
      expect(existsSync(filePath)).toBe(true);

      // Resume from file
      const conv2 = await Conversation.loadFromFile(filePath);
      expect(conv2.getId()).toBe(conv1.getId());
      expect(conv2.getTurns()).toHaveLength(1);
      expect(conv2.getHistory()).toHaveLength(2);
      expect(conv2.getProvider()).toBe("anthropic");

      // Send another turn on resumed conversation
      await conv2.send("What was my previous question?", silentHandler);
      expect(conv2.getTurns()).toHaveLength(2);
      expect(conv2.getHistory()).toHaveLength(4);
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });
});

describe.skipIf(!HAS_ANTHROPIC || !HAS_GEMINI)("Conversation persistence — provider switch Anthropic → Gemini", () => {
  it("should switch from Anthropic to Gemini with text history injection", async () => {
    const writer = new TestWriter();

    // Start with Anthropic
    const conv1 = new Conversation({
      provider: "anthropic",
      writers: [writer],
    });
    await conv1.send(
      "Remember this number: 73291. Just confirm you have it.",
      silentHandler
    );

    // Wait for writer
    await new Promise(r => setTimeout(r, 100));

    // Get the serialized state
    const serialized = writer.conversations[writer.conversations.length - 1];

    // Resume with Gemini
    const conv2 = await Conversation.resume(serialized, { provider: "gemini" });
    expect(conv2.getProvider()).toBe("gemini");

    // The model should have context from the previous conversation
    const result = await conv2.send(
      "What number did I ask you to remember?",
      silentHandler
    );
    expect(result.text).toContain("73291");
  });
});

describe.skipIf(!HAS_GEMINI || !HAS_OPENAI)("Conversation persistence — provider switch Gemini → OpenAI", () => {
  it("should switch from Gemini to OpenAI with text history injection", async () => {
    const writer = new TestWriter();

    // Start with Gemini
    const conv1 = new Conversation({
      provider: "gemini",
      writers: [writer],
    });
    await conv1.send(
      "Remember this number: 58204. Just confirm you have it.",
      silentHandler
    );

    // Wait for writer
    await new Promise(r => setTimeout(r, 100));

    // Get the serialized state
    const serialized = writer.conversations[writer.conversations.length - 1];

    // Resume with OpenAI — this uses the text-prefix injection path
    // (OpenAI doesn't accept message arrays, only previous_response_id)
    const conv2 = await Conversation.resume(serialized, { provider: "openai" });
    expect(conv2.getProvider()).toBe("openai");

    // The model should have context from the Gemini conversation
    const result = await conv2.send(
      "What number did I ask you to remember?",
      silentHandler
    );
    expect(result.text).toContain("58204");
  });
});

describe.skipIf(!HAS_ANTHROPIC || !HAS_OPENAI)("Conversation persistence — provider switch with file re-upload Anthropic → OpenAI", () => {
  const TEST_CSV_PATH = resolve(process.cwd(), "test-data/sample.csv");
  const HAS_CSV = existsSync(TEST_CSV_PATH);

  it.skipIf(!HAS_CSV)("should upload CSV to Anthropic, plot it, switch to OpenAI with files re-uploaded, and ask about the plot", async () => {
    const writer = new TestWriter();

    // --- Phase 1: Anthropic — upload CSV, ask it to plot ---
    const conv1 = new Conversation({
      provider: "anthropic",
      writers: [writer],
    });

    const uploaded = await conv1.uploadFile(TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();

    const plotResult = await conv1.send(
      "Read the uploaded CSV file. It has columns x and y. Create a scatter plot of x vs y using matplotlib. " +
      "Save the plot as plot.png.",
      silentHandler,
      { fileIds: [uploaded.file_id] }
    );

    expect(plotResult.text).toBeTruthy();

    // Wait for writer
    await new Promise(r => setTimeout(r, 200));

    // Verify turn was recorded with file context
    expect(conv1.getTurns()).toHaveLength(1);
    expect(conv1.getUploads()).toHaveLength(1);

    // Verify generated files have base64 data captured
    const turn1 = conv1.getTurns()[0];
    for (const gf of turn1.generatedFiles) {
      expect(gf.base64Data).toBeTruthy();
    }

    // Verify uploaded file has base64 data (persistUploadData defaults to true)
    expect(conv1.getUploads()[0].base64Data).toBeTruthy();

    // --- Phase 2: Switch to OpenAI — files get re-uploaded automatically ---
    const serialized = writer.conversations[writer.conversations.length - 1];

    const conv2 = await Conversation.resume(serialized, { provider: "openai" });
    expect(conv2.getProvider()).toBe("openai");

    // Files should have been re-uploaded to OpenAI
    const reuploadedIds = conv2.getReuploadedFileIds();
    expect(reuploadedIds.length).toBeGreaterThan(0);

    // The file ID map should contain the original upload
    const fileIdMap = conv2.getFileIdMap();
    expect(fileIdMap.has(uploaded.file_id)).toBe(true);

    // Ask OpenAI about the re-uploaded CSV using the OLD file ID (auto-translated)
    const newCsvId = fileIdMap.get(uploaded.file_id)!;
    const followUp = await conv2.send(
      "I've uploaded a CSV file. Read it and tell me: what are the column names and how many rows of data are there?",
      silentHandler,
      { fileIds: [newCsvId] }
    );

    // OpenAI should be able to read the re-uploaded CSV
    expect(followUp.text).toMatch(/\bx\b/i);
    expect(followUp.text).toMatch(/\by\b/i);

    // Cleanup uploaded files on both providers
    await conv1.deleteFile(uploaded.file_id);
    for (const id of reuploadedIds) {
      try { await conv2.deleteFile(id); } catch {}
    }
  });
});

describe.skipIf(!HAS_ANTHROPIC)("Conversation persistence — upload tracking", () => {
  const TEST_CSV_PATH = resolve(process.cwd(), "test-data/sample.csv");
  const HAS_CSV = existsSync(TEST_CSV_PATH);

  it.skipIf(!HAS_CSV)("should track uploads in serialized output", async () => {
    const writer = new TestWriter();
    const conv = new Conversation({
      provider: "anthropic",
      writers: [writer],
    });

    const uploaded = await conv.uploadFile(TEST_CSV_PATH);

    // Wait for writer
    await new Promise(r => setTimeout(r, 100));

    expect(conv.getUploads()).toHaveLength(1);
    expect(conv.getUploads()[0].fileId).toBe(uploaded.file_id);
    expect(conv.getUploads()[0].filename).toBe(uploaded.filename);
    expect(conv.getUploads()[0].provider).toBe("anthropic");
    expect(writer.uploads).toHaveLength(1);

    // Cleanup
    await conv.deleteFile(uploaded.file_id);
  });
});
