/**
 * Test: Multi-tool-call response verification
 *
 * Sends a prompt designed to force 2+ separate code executions
 * and verifies the response contains multiple tool calls with
 * continuation text after the last one.
 *
 * Usage:
 *   npx tsx src/test/test-multi-tool-calls.ts gemini
 *   npx tsx src/test/test-multi-tool-calls.ts openai
 */

import "dotenv/config";
import { Conversation } from "../modules/conversation.js";
import type { StreamEvent } from "../modules/types.js";

const PROMPT = `
Execute TWO SEPARATE code blocks (do NOT combine them into one):

CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list.

After BOTH code executions are complete, write a brief paragraph summarizing both results.
`.trim();

async function main() {
  const provider = process.argv[2] as "gemini" | "openai" | "anthropic";
  if (!provider || !["gemini", "openai", "anthropic"].includes(provider)) {
    console.error("Usage: npx tsx src/test/test-multi-tool-calls.ts <gemini|openai|anthropic>");
    process.exit(1);
  }

  console.log("=".repeat(70));
  console.log(`Multi-Tool-Call Test — Provider: ${provider}`);
  console.log("=".repeat(70));
  console.log(`\nPrompt:\n${PROMPT}\n`);
  console.log("-".repeat(70));

  const conv = new Conversation({ provider });
  const events: Array<StreamEvent & { index: number }> = [];
  let eventIndex = 0;

  const handler = (event: StreamEvent) => {
    const idx = eventIndex++;
    events.push({ ...event, index: idx });

    // Pretty-print event stream
    switch (event.type) {
      case "text":
        process.stdout.write(event.text || "");
        break;
      case "tool_start":
        console.log(`\n>>> [${idx}] TOOL_START: ${event.toolName}`);
        break;
      case "code":
        process.stdout.write(event.code || "");
        break;
      case "code_executing":
        console.log(`    [${idx}] CODE_EXECUTING`);
        break;
      case "code_complete":
        console.log(`\n    [${idx}] CODE_COMPLETE`);
        break;
      case "code_output":
        console.log(`    [${idx}] CODE_OUTPUT: ${(event.output || "").slice(0, 120)}${(event.output || "").length > 120 ? "..." : ""}`);
        break;
      case "tool_end":
        console.log(`<<< [${idx}] TOOL_END: ${event.toolName}\n`);
        break;
    }
  };

  try {
    const result = await conv.send(PROMPT, handler);

    console.log("\n" + "-".repeat(70));
    console.log("\nRESULT SUMMARY:");
    console.log(`  text length:     ${result.text.length}`);
    console.log(`  codeArtifacts:   ${result.codeArtifacts.length}`);
    console.log(`  files:           ${result.files.length}`);

    // Analyze events
    const toolStarts = events.filter(e => e.type === "tool_start");
    const toolEnds = events.filter(e => e.type === "tool_end");
    const codeOutputs = events.filter(e => e.type === "code_output");
    const textEvents = events.filter(e => e.type === "text");

    console.log(`\nEVENT ANALYSIS:`);
    console.log(`  tool_start count:  ${toolStarts.length}`);
    console.log(`  tool_end count:    ${toolEnds.length}`);
    console.log(`  code_output count: ${codeOutputs.length}`);
    console.log(`  text event count:  ${textEvents.length}`);

    // Check for text after last tool_end
    const lastToolEndIdx = toolEnds.length > 0 ? toolEnds[toolEnds.length - 1].index : -1;
    const textAfterLastTool = textEvents.filter(e => e.index > lastToolEndIdx);
    const textAfterLastToolContent = textAfterLastTool.map(e => e.text || "").join("");

    console.log(`  last tool_end at:  event[${lastToolEndIdx}]`);
    console.log(`  text events after: ${textAfterLastTool.length}`);
    console.log(`  text after tools:  "${textAfterLastToolContent.slice(0, 100)}${textAfterLastToolContent.length > 100 ? "..." : ""}"`);

    // Assertions
    const checks = [
      { name: "2+ code artifacts", pass: result.codeArtifacts.length >= 2 },
      { name: "2+ tool_start events", pass: toolStarts.length >= 2 },
      { name: "2+ tool_end events", pass: toolEnds.length >= 2 },
      { name: "2+ code_output events", pass: codeOutputs.length >= 2 },
      { name: "text after last tool", pass: textAfterLastTool.length > 0 && textAfterLastToolContent.trim().length > 10 },
      { name: "result.text non-empty", pass: result.text.length > 50 },
    ];

    console.log(`\nCHECKS:`);
    let allPass = true;
    for (const check of checks) {
      const icon = check.pass ? "PASS" : "FAIL";
      console.log(`  [${icon}] ${check.name}`);
      if (!check.pass) allPass = false;
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`OVERALL: ${allPass ? "PASS" : "FAIL"}`);
    console.log("=".repeat(70));

    process.exit(allPass ? 0 : 1);
  } catch (error) {
    console.error("\nERROR:", error);
    process.exit(1);
  }
}

main();
