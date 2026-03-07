/**
 * Test: Anthropic Claude Code Execution
 *
 * Tests the code execution tool with:
 * - Streaming response
 * - Image generation (plot)
 * - Mathematical computation (finding zeros)
 * - File artifact retrieval
 */

import "dotenv/config";
import {
  createAnthropicClient,
  executeCodeWithClaudeStreaming,
  downloadGeneratedFiles,
  StreamEvent,
} from "../modules/anthropic-client.js";

const TEST_PROMPT = `
Please plot the function f(x) = (x-1)^3 - exp(-x) - 5 and compute all its zeros.

Requirements:
1. Create a clear plot showing the function over a suitable range that captures all zeros
2. Use numerical methods (like scipy.optimize.fsolve or brentq) to find ALL zeros of the function
3. Mark the zeros on the plot with red dots
4. Add a grid, title, axis labels, and a legend
5. Save the plot as 'function_plot.png'

Please show me:
- The computed zeros (with good precision)
- The saved plot file
`;

async function main() {
  console.log("=".repeat(60));
  console.log("Anthropic Claude Code Execution Test");
  console.log("=".repeat(60));
  console.log("\nPrompt:", TEST_PROMPT.trim());
  console.log("\n" + "-".repeat(60));
  console.log("Response (streaming):\n");

  const client = createAnthropicClient();

  // Track events for logging
  const handleEvent = (event: StreamEvent) => {
    switch (event.type) {
      case "text":
        process.stdout.write(event.text || "");
        break;
      case "tool_start":
        console.log(`\n[Tool: ${event.toolName} started]`);
        break;
      case "tool_end":
        console.log(`[Tool: ${event.toolName} completed]`);
        break;
      case "tool_input":
        process.stdout.write(event.text || "");
        break;
    }
  };

  try {
    const startTime = Date.now();

    // Execute with streaming
    const result = await executeCodeWithClaudeStreaming(
      client,
      TEST_PROMPT,
      handleEvent
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("\n\n" + "-".repeat(60));
    console.log(`\nExecution completed in ${duration}s`);

    // Show container info
    if (result.containerId) {
      console.log(`Container ID: ${result.containerId}`);
    }

    // Show code artifacts
    if (result.codeArtifacts.length > 0) {
      console.log(`\nCode artifacts: ${result.codeArtifacts.length}`);
      for (const artifact of result.codeArtifacts) {
        console.log(`\n--- ${artifact.path} (${artifact.language}) ---`);
        console.log(artifact.code);
        console.log("--- end ---");
      }
    }

    // Download generated files
    if (result.files.length > 0) {
      console.log(`\nGenerated image/data files: ${result.files.length}`);

      const downloadedPaths = await downloadGeneratedFiles(
        client,
        result.files,
        "."
      );

      console.log("\nDownloaded artifacts:");
      for (const path of downloadedPaths) {
        console.log(`  - ${path}`);
      }
    } else {
      console.log("\nNo image/data files were generated.");
    }

    console.log("\n" + "=".repeat(60));
    console.log("Test completed successfully!");
    console.log("=".repeat(60));

  } catch (error) {
    console.error("\nTest failed:", error);
    process.exit(1);
  }
}

main();
