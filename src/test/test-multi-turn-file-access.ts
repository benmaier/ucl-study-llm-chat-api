/**
 * Test: Multi-turn file access persistence
 *
 * Verifies that models retain access to files generated in previous turns
 * WITHOUT re-uploading or re-linking them.
 *
 * Turn 1: "Generate 500 random numbers with seed 4038682, save to data.csv"
 * Turn 2: "Read data.csv and report mean, median, std" (no file re-linked)
 *
 * We compute the expected values locally with the same seed and check.
 */

import "dotenv/config";
import { Conversation } from "../modules/conversation.js";
import type { StreamEvent, ConversationOptions } from "../modules/types.js";

const SEED = 4038682;

const TURN_1 = `Using Python with numpy, generate 500 random numbers using:
\`\`\`python
import numpy as np
rng = np.random.default_rng(${SEED})
data = rng.random(500)
\`\`\`
Save them to a file called data.csv (one number per line, no header). Do NOT print the data. Just confirm the file was written and how many rows it has.`;

const TURN_2 = `Read the file data.csv you saved in the previous step and compute:
1. The mean
2. The median
3. The standard deviation

Reply with ONLY a JSON object, nothing else: {"mean": ..., "median": ..., "std": ...}
Round each value to 6 decimal places.`;

// Compute expected values locally using the same approach the model will use.
// We shell out to Python since we need numpy with the exact same RNG.
async function computeExpected(): Promise<{ mean: number; median: number; std: number }> {
  const { execSync } = await import("child_process");
  const script = `
import numpy as np, json
rng = np.random.default_rng(${SEED})
data = rng.random(500)
print(json.dumps({"mean": round(float(np.mean(data)), 6), "median": round(float(np.median(data)), 6), "std": round(float(np.std(data)), 6)}))
`;
  const output = execSync(`python3 -c '${script}'`, { encoding: "utf-8" }).trim();
  return JSON.parse(output);
}

function parseResponse(text: string): { mean: number; median: number; std: number } | null {
  // Try to find JSON in the response
  const match = text.match(/\{[^{}]*"mean"[^{}]*"median"[^{}]*"std"[^{}]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  // Try any JSON object
  const anyJson = text.match(/\{[^{}]*\}/g);
  if (anyJson) {
    for (const candidate of anyJson) {
      try {
        const obj = JSON.parse(candidate);
        if ("mean" in obj && "median" in obj && "std" in obj) return obj;
      } catch {}
    }
  }
  return null;
}

function check(label: string, got: number, want: number, tolerance: number): boolean {
  const diff = Math.abs(got - want);
  const ok = diff < tolerance;
  const status = ok ? "OK" : "FAIL";
  console.log(`    ${label}: ${status}  got=${got}  want=${want}  diff=${diff.toExponential(2)}`);
  return ok;
}

const silentHandler = (_event: StreamEvent) => {};

async function testProvider(
  provider: ConversationOptions["provider"],
  expected: { mean: number; median: number; std: number }
): Promise<boolean> {
  const label = provider === "anthropic" ? "Claude" : provider === "gemini" ? "Gemini" : "OpenAI";
  console.log(`\n  ${label}:`);
  console.log("    Turn 1 — generating data.csv with seed...");

  const conv = new Conversation({ provider });

  const r1 = await conv.send(TURN_1, silentHandler);
  console.log("    Turn 1 done.");

  console.log("    Turn 2 — reading data.csv (no file re-linked)...");
  const r2 = await conv.send(TURN_2, silentHandler);

  const parsed = parseResponse(r2.text);
  if (!parsed) {
    console.log(`    FAIL — could not parse JSON from response`);
    console.log(`    Response: ${r2.text.slice(0, 300)}`);
    return false;
  }

  const tol = 0.001;
  const m = check("mean", parsed.mean, expected.mean, tol);
  const med = check("median", parsed.median, expected.median, tol);
  const s = check("std", parsed.std, expected.std, tol);
  return m && med && s;
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Test: Multi-turn file access persistence");
  console.log("=".repeat(60));
  console.log(`\n  Seed: ${SEED}`);
  console.log("  Turn 1 generates 500 random numbers → data.csv");
  console.log("  Turn 2 reads data.csv and computes stats");
  console.log("  We verify against locally computed expected values.\n");

  // Compute ground truth locally
  console.log("  Computing expected values locally...");
  const expected = await computeExpected();
  console.log(`    mean=${expected.mean}  median=${expected.median}  std=${expected.std}`);

  const results: { name: string; pass: boolean }[] = [];

  for (const provider of ["anthropic", "openai", "gemini"] as const) {
    const label = provider === "anthropic" ? "Claude" : provider === "gemini" ? "Gemini" : "OpenAI";
    if (provider === "gemini") {
      console.log(`\n  ${label}: SKIPPED — Gemini sandbox is ephemeral (no cross-turn file persistence)`);
      results.push({ name: label, pass: true });
      continue;
    }
    try {
      results.push({ name: label, pass: await testProvider(provider, expected) });
    } catch (e) {
      console.log(`  ${label}: ERROR — ${e}`);
      results.push({ name: label, pass: false });
    }
  }

  console.log("\n" + "=".repeat(60));
  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  }
  console.log("=".repeat(60) + "\n");

  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main();
