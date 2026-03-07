/**
 * Demo: Multi-turn conversation with both Claude and OpenAI
 *
 * Turn 1: "Plot y = sin(x) * exp(-x/5) and save it"
 * Turn 2: "Change the color to red and add the derivative"
 *
 * Turn 2 only makes sense if the model remembers Turn 1.
 */

import "dotenv/config";
import {
  createAnthropicClient,
  executeCodeWithClaudeMultiTurn,
  downloadGeneratedFiles as downloadClaudeFiles,
} from "../modules/anthropic-client.js";
import {
  createOpenAIClient,
  executeCodeWithOpenAIMultiTurn,
  downloadGeneratedFiles as downloadOpenAIFiles,
} from "../modules/openai-client.js";
import type { StreamEvent } from "../modules/types.js";

const TURN_1 = "Plot y = sin(x) * exp(-x/5) for x from 0 to 20. Blue line, grid, title, legend. Save as plot.png.";
const TURN_2 = "Now change the line to red, and add the analytical derivative as a dashed green line on the same plot. Update the legend and save again.";

const handleEvent = (event: StreamEvent) => {
  if (event.type === "text") process.stdout.write(event.text || "");
  if (event.type === "tool_start") console.log(`\n  [${event.toolName} running...]`);
  if (event.type === "tool_end") console.log(`  [${event.toolName} done]`);
};

async function demoClaude() {
  console.log("\n" + "═".repeat(60));
  console.log("  CLAUDE — Multi-turn");
  console.log("═".repeat(60));

  const client = createAnthropicClient();

  // Turn 1
  console.log(`\n> Turn 1: ${TURN_1}\n`);
  const r1 = await executeCodeWithClaudeMultiTurn(client, TURN_1, handleEvent);
  if (r1.files.length) await downloadClaudeFiles(client, r1.files, ".");
  console.log(`\n  Container: ${r1.containerId}`);

  // Turn 2 — pass previous messages + reuse container
  console.log(`\n> Turn 2: ${TURN_2}\n`);
  const r2 = await executeCodeWithClaudeMultiTurn(
    client, TURN_2, handleEvent, r1.messages,
    { containerId: r1.containerId }
  );
  if (r2.files.length) {
    const paths = await downloadClaudeFiles(client, r2.files, ".");
    console.log(`\n  Downloaded: ${paths.join(", ")}`);
  }

  console.log("\n  Claude multi-turn complete.\n");
}

async function demoOpenAI() {
  console.log("═".repeat(60));
  console.log("  OPENAI — Multi-turn");
  console.log("═".repeat(60));

  const client = createOpenAIClient();

  // Turn 1
  console.log(`\n> Turn 1: ${TURN_1}\n`);
  const r1 = await executeCodeWithOpenAIMultiTurn(client, TURN_1, handleEvent);
  if (r1.files.length) await downloadOpenAIFiles(r1.files, ".");
  console.log(`\n  Response ID: ${r1.responseId}`);

  // Turn 2 — chain via responseId
  console.log(`\n> Turn 2: ${TURN_2}\n`);
  const r2 = await executeCodeWithOpenAIMultiTurn(
    client, TURN_2, handleEvent, r1.responseId
  );
  if (r2.files.length) {
    const paths = await downloadOpenAIFiles(r2.files, ".");
    console.log(`\n  Downloaded: ${paths.join(", ")}`);
  }

  console.log("\n  OpenAI multi-turn complete.\n");
}

async function main() {
  console.log("\n" + "━".repeat(60));
  console.log("  DEMO: Multi-turn code execution conversations");
  console.log("━".repeat(60));
  console.log(`\n  Turn 1: "${TURN_1}"`);
  console.log(`  Turn 2: "${TURN_2}"`);
  console.log("  (Turn 2 only works if the model remembers Turn 1)");

  const start = Date.now();

  await demoClaude();
  await demoOpenAI();

  console.log("━".repeat(60));
  console.log(`  Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log("━".repeat(60) + "\n");
}

main().catch(console.error);
