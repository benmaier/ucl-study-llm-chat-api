/**
 * Test: OpenAI File Upload and Code Execution
 *
 * Tests uploading a CSV file and asking OpenAI to plot the data.
 */

import "dotenv/config";
import {
  createOpenAIClient,
  uploadFile,
  executeCodeWithOpenAI,
  downloadGeneratedFiles,
  deleteFile,
} from "../modules/openai-client.js";
import { resolve } from "path";

const TEST_CSV_PATH = resolve(process.cwd(), "test-data/sample.csv");

async function main() {
  console.log("=".repeat(60));
  console.log("Test: OpenAI File Upload");
  console.log("=".repeat(60));

  const client = createOpenAIClient();

  try {
    // Step 1: Upload the CSV file
    console.log("\n1. Uploading CSV file...");
    const uploaded = await uploadFile(client, TEST_CSV_PATH);
    console.log(`   File ID: ${uploaded.file_id}`);
    console.log(`   Filename: ${uploaded.filename}`);
    console.log(`   MIME Type: ${uploaded.mime_type}`);
    console.log(`   Size: ${uploaded.size_bytes} bytes`);

    // Step 2: Execute code with the uploaded file
    console.log("\n2. Asking OpenAI to plot the CSV data...");
    const result = await executeCodeWithOpenAI(
      client,
      "Read the uploaded CSV file and create a scatter plot of x vs y. Save the plot as plot.png. Add a title and axis labels.",
      { fileIds: [uploaded.file_id] }
    );

    // Step 3: Display results
    console.log("\n3. Results:");
    console.log(`   Text response: ${result.text.slice(0, 200)}...`);
    console.log(`   Files generated: ${result.files.length}`);
    console.log(`   Code artifacts: ${result.codeArtifacts.length}`);

    // Show code artifacts
    if (result.codeArtifacts.length > 0) {
      console.log("\n4. Code Artifacts:");
      for (const artifact of result.codeArtifacts) {
        console.log(`   - ${artifact.path} (${artifact.language})`);
        console.log("   Code preview:");
        console.log(
          artifact.code
            .split("\n")
            .slice(0, 10)
            .map((line) => "     " + line)
            .join("\n")
        );
        if (artifact.code.split("\n").length > 10) {
          console.log("     ...");
        }
      }
    }

    // Step 4: Download generated files
    if (result.files.length > 0) {
      console.log("\n5. Downloading generated files...");
      const paths = await downloadGeneratedFiles(result.files, "./test-data");
      for (const path of paths) {
        console.log(`   Saved: ${path}`);
      }
    }

    // Step 5: Clean up - delete uploaded file
    console.log("\n6. Cleaning up uploaded file...");
    await deleteFile(client, uploaded.file_id);
    console.log("   Deleted uploaded file");

    console.log("\n" + "=".repeat(60));
    console.log("Test completed successfully!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

main();
