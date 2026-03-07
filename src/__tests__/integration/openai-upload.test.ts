import {
  createOpenAIClient,
  uploadFile,
  executeCodeWithOpenAI,
  downloadGeneratedFiles,
  deleteFile,
} from "../../modules/openai-client.js";
import { resolve } from "path";
import { existsSync } from "fs";

const HAS_KEY = !!process.env.OPENAI_API_KEY;
const TEST_CSV_PATH = resolve(process.cwd(), "test-data/sample.csv");
const HAS_CSV = existsSync(TEST_CSV_PATH);

describe.skipIf(!HAS_KEY || !HAS_CSV)("OpenAI file upload + code execution", () => {
  it("should upload, execute, download, and cleanup", async () => {
    const client = createOpenAIClient();

    // Upload
    const uploaded = await uploadFile(client, TEST_CSV_PATH);
    expect(uploaded.file_id).toBeTruthy();
    expect(uploaded.filename).toBeTruthy();

    // Execute
    const result = await executeCodeWithOpenAI(
      client,
      "Read the uploaded CSV file and create a scatter plot of x vs y. Save the plot as plot.png.",
      { fileIds: [uploaded.file_id] }
    );
    expect(result.text).toBeTruthy();
    expect(result.codeArtifacts.length).toBeGreaterThan(0);

    // Download
    if (result.files.length > 0) {
      const paths = await downloadGeneratedFiles(result.files, "/tmp");
      expect(paths.length).toBeGreaterThan(0);
    }

    // Cleanup
    await deleteFile(client, uploaded.file_id);
  });
});
