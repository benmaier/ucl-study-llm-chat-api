import { Conversation } from "../../modules/conversation.js";
import type { StreamEvent, ConversationOptions } from "../../modules/types.js";

const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY;
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
const HAS_GEMINI = !!process.env.GOOGLE_API_KEY;

const TURN_1 = "Plot y = sin(x) * exp(-x/5) for x from 0 to 20. Blue line, grid, title, legend. Save as plot.png.";
const TURN_2 = "Now change the line to red, and add the analytical derivative as a dashed green line on the same plot. Update the legend and save again.";

const silentHandler = (_event: StreamEvent) => {};

async function runMultiTurnDemo(provider: ConversationOptions["provider"]) {
  const conv = new Conversation({ provider });

  const r1 = await conv.send(TURN_1, silentHandler);
  expect(r1.text).toBeTruthy();
  expect(r1.codeArtifacts.length).toBeGreaterThan(0);

  const r2 = await conv.send(TURN_2, silentHandler);
  expect(r2.text).toBeTruthy();
  expect(r2.codeArtifacts.length).toBeGreaterThan(0);

  expect(conv.getHistory().length).toBe(4);
}

describe.skipIf(!HAS_ANTHROPIC)("Multi-turn demo — Claude", () => {
  it("should handle two-turn plotting conversation", async () => {
    await runMultiTurnDemo("anthropic");
  });
});

describe.skipIf(!HAS_OPENAI)("Multi-turn demo — OpenAI", () => {
  it("should handle two-turn plotting conversation", async () => {
    await runMultiTurnDemo("openai");
  });
});

describe.skipIf(!HAS_GEMINI)("Multi-turn demo — Gemini", () => {
  it("should handle two-turn plotting conversation", async () => {
    await runMultiTurnDemo("gemini");
  });
});
