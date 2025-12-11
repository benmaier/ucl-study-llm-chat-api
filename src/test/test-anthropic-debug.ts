/**
 * Debug Test: Anthropic Claude Code Execution
 *
 * A simpler test to debug the response structure and file handling
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "fs";

// Simple prompt that should generate a file
const TEST_PROMPT = `
Create a simple plot of y = x^2 from x=-2 to x=2 and save it as plot.png.
Just create the plot, nothing else.
`;

async function main() {
  console.log("=".repeat(60));
  console.log("Debug: Anthropic Claude Code Execution");
  console.log("=".repeat(60));

  const client = new Anthropic();

  try {
    console.log("\nSending request...\n");

    const response = await client.beta.messages.create({
      model: "claude-sonnet-4-5-20250929",
      betas: ["code-execution-2025-08-25", "files-api-2025-04-14"],
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: TEST_PROMPT,
        },
      ],
      tools: [
        {
          type: "code_execution_20250825",
          name: "code_execution",
        },
      ],
    });

    console.log("Response received!\n");

    // Log container info
    console.log("Container:", (response as any).container);

    // Log each content block
    console.log("\nContent blocks:", response.content.length);
    for (let i = 0; i < response.content.length; i++) {
      const block = response.content[i];
      console.log(`\n--- Block ${i} ---`);
      console.log("Type:", block.type);

      if (block.type === "text") {
        console.log("Text:", block.text.slice(0, 200) + (block.text.length > 200 ? "..." : ""));
      } else {
        // Log the full structure for non-text blocks
        console.log("Full block:", JSON.stringify(block, null, 2).slice(0, 1000));
      }
    }

    // Try to find files
    console.log("\n" + "=".repeat(60));
    console.log("Looking for files...\n");

    const files: { file_id: string; filename?: string }[] = [];

    for (const block of response.content) {
      if (block.type === "bash_code_execution_tool_result") {
        console.log("Found bash_code_execution_tool_result block");
        const result = (block as any).content;
        console.log("Result type:", result?.type);
        console.log("Result content:", JSON.stringify(result?.content, null, 2));

        if (result?.content && Array.isArray(result.content)) {
          for (const item of result.content) {
            if (item.file_id) {
              console.log("Found file:", item);
              files.push({
                file_id: item.file_id,
                filename: item.filename,
              });
            }
          }
        }
      }
    }

    console.log("\nTotal files found:", files.length);

    // Try to download files
    if (files.length > 0) {
      console.log("\nAttempting to download files...\n");

      for (const file of files) {
        const url = `https://api.anthropic.com/v1/files/${file.file_id}/content`;
        console.log(`Downloading: ${url}`);

        const downloadResponse = await fetch(url, {
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY || "",
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "files-api-2025-04-14",
          },
        });

        console.log(`Status: ${downloadResponse.status} ${downloadResponse.statusText}`);

        if (downloadResponse.ok) {
          const buffer = Buffer.from(await downloadResponse.arrayBuffer());
          const filename = file.filename || `downloaded_${file.file_id.slice(-8)}.png`;
          writeFileSync(filename, buffer);
          console.log(`Saved: ${filename} (${buffer.length} bytes)`);
        } else {
          const errorText = await downloadResponse.text();
          console.log("Error:", errorText);
        }
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("Debug test complete");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
