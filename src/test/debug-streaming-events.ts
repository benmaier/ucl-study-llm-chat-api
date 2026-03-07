/**
 * Debug: Log all raw streaming events with timestamps
 * to diagnose whether code is actually streaming incrementally.
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const PROMPT = "Create a simple plot of y = x^2 and save it as plot.png.";

async function main() {
  const client = new Anthropic();
  const start = Date.now();
  const ts = () => `+${((Date.now() - start) / 1000).toFixed(2)}s`;

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    messages: [{ role: "user", content: PROMPT }],
    tools: [{ type: "code_execution_20250825" as any, name: "code_execution" }],
  } as any);

  let currentTool = "";

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = (event as any).content_block;
      console.log(`${ts()} content_block_start  type=${block?.type}  name=${block?.name || "-"}`);
      currentTool = block?.name || "";
    } else if (event.type === "content_block_delta") {
      const delta = (event as any).delta;
      if (delta?.type === "text_delta") {
        console.log(`${ts()} text_delta           len=${delta.text.length}  "${delta.text.slice(0, 60)}..."`);
      } else if (delta?.type === "input_json_delta") {
        const pj = delta.partial_json || "";
        console.log(`${ts()} input_json_delta     tool=${currentTool}  len=${pj.length}  "${pj.slice(0, 80)}${pj.length > 80 ? "..." : ""}"`);
      } else {
        console.log(`${ts()} delta                type=${delta?.type}  keys=${Object.keys(delta || {})}`);
      }
    } else if (event.type === "content_block_stop") {
      console.log(`${ts()} content_block_stop`);
      currentTool = "";
    } else if (event.type === "message_start") {
      console.log(`${ts()} message_start`);
    } else if (event.type === "message_delta") {
      console.log(`${ts()} message_delta`);
    } else if (event.type === "message_stop") {
      console.log(`${ts()} message_stop`);
    } else {
      console.log(`${ts()} ${event.type}`);
    }
  }
}

main().catch(console.error);
