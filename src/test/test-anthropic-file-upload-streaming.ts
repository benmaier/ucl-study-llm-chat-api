/**
 * Test: Anthropic Claude File Upload with Streaming
 *
 * Demonstrates live streaming of code execution with file upload.
 * Shows real-time text, tool usage, and code generation.
 */

import "dotenv/config";
import {
  createAnthropicClient,
  uploadFile,
  executeCodeWithClaudeStreaming,
  downloadGeneratedFiles,
  deleteFile,
  StreamEvent,
} from "../modules/anthropic-client.js";
import { resolve } from "path";

const TEST_CSV_PATH = resolve(process.cwd(), "test-data/sample.csv");

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function handleStreamEvent(event: StreamEvent) {
  switch (event.type) {
    case "text":
      // Stream text in green
      process.stdout.write(`${colors.green}${event.text}${colors.reset}`);
      break;

    case "tool_start":
      // Tool starting - show in yellow
      console.log(`\n${colors.yellow}${colors.bright}▶ [${event.toolName} starting...]${colors.reset}`);
      break;

    case "tool_input":
      // Tool input (code being written) - show in cyan
      process.stdout.write(`${colors.cyan}${event.text}${colors.reset}`);
      break;

    case "tool_end":
      // Tool completed - show in yellow
      console.log(`\n${colors.yellow}${colors.bright}✓ [${event.toolName} completed]${colors.reset}\n`);
      break;

    case "code_executing":
      console.log(`${colors.magenta}⚙ [Executing code...]${colors.reset}`);
      break;

    case "code_complete":
      console.log(`${colors.magenta}✓ [Code execution finished]${colors.reset}`);
      break;
  }
}

async function main() {
  console.log(`${colors.bright}${"=".repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}Claude File Upload with Live Streaming${colors.reset}`);
  console.log(`${colors.bright}${"=".repeat(70)}${colors.reset}`);
  console.log(`
${colors.dim}Legend:${colors.reset}
  ${colors.green}Green${colors.reset}  = AI text response
  ${colors.yellow}Yellow${colors.reset} = Tool start/end
  ${colors.cyan}Cyan${colors.reset}   = Code being written (tool input)
`);

  const client = createAnthropicClient();

  try {
    // Step 1: Upload the CSV file
    console.log(`${colors.blue}1. Uploading CSV file...${colors.reset}`);
    const uploaded = await uploadFile(client, TEST_CSV_PATH);
    console.log(`   File ID: ${uploaded.file_id}`);
    console.log(`   Filename: ${uploaded.filename}\n`);

    // Step 2: Execute with streaming
    console.log(`${colors.blue}2. Streaming response:${colors.reset}\n`);
    console.log("-".repeat(70));

    const result = await executeCodeWithClaudeStreaming(
      client,
      `Read the uploaded CSV file and:
1. Print out the data
2. Calculate basic statistics (mean, min, max for each column)
3. Create a scatter plot of x vs y with a trend line
4. Save the plot as analysis.png

Show your work step by step.`,
      handleStreamEvent,
      { fileIds: [uploaded.file_id] }
    );

    console.log("-".repeat(70));

    // Step 3: Summary
    console.log(`\n${colors.blue}3. Summary:${colors.reset}`);
    console.log(`   Files generated: ${result.files.length}`);
    console.log(`   Code artifacts: ${result.codeArtifacts.length}`);

    if (result.codeArtifacts.length > 0) {
      console.log(`\n${colors.blue}4. Code Artifacts:${colors.reset}`);
      for (const artifact of result.codeArtifacts) {
        console.log(`   ${colors.dim}${artifact.path}${colors.reset}`);
      }
    }

    // Step 4: Download files
    if (result.files.length > 0) {
      console.log(`\n${colors.blue}5. Downloading generated files...${colors.reset}`);
      const paths = await downloadGeneratedFiles(client, result.files, "./test-data");
      for (const path of paths) {
        console.log(`   Saved: ${path}`);
      }
    }

    // Step 5: Cleanup
    console.log(`\n${colors.blue}6. Cleaning up...${colors.reset}`);
    await deleteFile(client, uploaded.file_id);
    console.log("   Deleted uploaded file");

    console.log(`\n${colors.bright}${"=".repeat(70)}${colors.reset}`);
    console.log(`${colors.green}${colors.bright}Test completed successfully!${colors.reset}`);
    console.log(`${colors.bright}${"=".repeat(70)}${colors.reset}`);
  } catch (error) {
    console.error(`\n${colors.bright}Error:${colors.reset}`, error);
    process.exit(1);
  }
}

main();
