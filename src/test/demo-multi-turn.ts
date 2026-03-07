/**
 * Demo: Multi-turn conversation with both Claude and OpenAI
 *
 * Turn 1: "Plot y = sin(x) * exp(-x/5) and save it"
 * Turn 2: "Change the color to red and add the derivative"
 *
 * Turn 2 only makes sense if the model remembers Turn 1.
 */

import "dotenv/config";
import { Conversation } from "../modules/conversation.js";
import type { StreamEvent, ConversationOptions } from "../modules/types.js";

const TURN_1 = "Plot y = sin(x) * exp(-x/5) for x from 0 to 20. Blue line, grid, title, legend. Save as plot.png.";
const TURN_2 = "Now change the line to red, and add the analytical derivative as a dashed green line on the same plot. Update the legend and save again.";

const handleEvent = (event: StreamEvent) => {
  if (event.type === "text") process.stdout.write(event.text || "");
  if (event.type === "tool_start") console.log(`\n  [${event.toolName} running...]`);
  if (event.type === "tool_input") process.stdout.write(event.text || "");
  if (event.type === "code") process.stdout.write(event.code || "");
  if (event.type === "tool_end") console.log(`  [${event.toolName} done]`);
};

async function demoProvider(provider: ConversationOptions["provider"]) {
  const label = provider === "anthropic" ? "CLAUDE" : provider === "gemini" ? "GEMINI" : "OPENAI";
  console.log("\n" + "═".repeat(60));
  console.log(`  ${label} — Multi-turn`);
  console.log("═".repeat(60));

  const conv = new Conversation({ provider });

  // Turn 1
  console.log(`\n> Turn 1: ${TURN_1}\n`);
  const r1 = await conv.send(TURN_1, handleEvent);
  if (r1.files.length) await conv.downloadFiles(r1.files, ".");

  // Turn 2
  console.log(`\n> Turn 2: ${TURN_2}\n`);
  const r2 = await conv.send(TURN_2, handleEvent);
  if (r2.files.length) {
    const paths = await conv.downloadFiles(r2.files, ".");
    console.log(`\n  Downloaded: ${paths.join(", ")}`);
  }

  console.log(`\n  ${label} multi-turn complete.`);
  console.log(`  History: ${conv.getHistory().length} messages\n`);
}

async function main() {
  console.log("\n" + "━".repeat(60));
  console.log("  DEMO: Multi-turn code execution conversations");
  console.log("━".repeat(60));
  console.log(`\n  Turn 1: "${TURN_1}"`);
  console.log(`  Turn 2: "${TURN_2}"`);
  console.log("  (Turn 2 only works if the model remembers Turn 1)");

  const start = Date.now();

  await demoProvider("anthropic");
  await demoProvider("openai");
  await demoProvider("gemini");

  console.log("━".repeat(60));
  console.log(`  Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log("━".repeat(60) + "\n");
}

main().catch(console.error);
