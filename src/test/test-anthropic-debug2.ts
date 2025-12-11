/**
 * Debug Test 2: Check streaming code artifact extraction
 */

import "dotenv/config";
import {
  createAnthropicClient,
  executeCodeWithClaudeStreaming,
  StreamEvent,
} from "../modules/anthropic-client.js";

const TEST_PROMPT = `Create a simple plot of y = x^2 and save it as plot.png.`;

async function main() {
  console.log("Testing code artifact extraction from streaming...\n");

  const client = createAnthropicClient();

  const handleEvent = (event: StreamEvent) => {
    if (event.type === "text") {
      process.stdout.write(event.text || "");
    } else if (event.type === "tool_start") {
      console.log(`\n[${event.toolName}]`);
    }
  };

  const result = await executeCodeWithClaudeStreaming(client, TEST_PROMPT, handleEvent);

  console.log("\n\n--- Results ---");
  console.log("Text length:", result.text.length);
  console.log("Files:", result.files.length);
  console.log("Code artifacts:", result.codeArtifacts.length);

  if (result.codeArtifacts.length > 0) {
    for (const artifact of result.codeArtifacts) {
      console.log(`\nCode artifact: ${artifact.path} (${artifact.language})`);
      console.log(artifact.code);
    }
  } else {
    console.log("\nNo code artifacts found. This is unexpected!");
  }
}

main();
