import { Conversation } from "../../modules/conversation.js";
import { parseResponse } from "../../modules/helpers.js";
import type { StreamEvent, ConversationOptions } from "../../modules/types.js";
import { execSync } from "child_process";

const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY;
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;

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

function computeExpected(): { mean: number; median: number; std: number } {
  const script = `
import numpy as np, json
rng = np.random.default_rng(${SEED})
data = rng.random(500)
print(json.dumps({"mean": round(float(np.mean(data)), 6), "median": round(float(np.median(data)), 6), "std": round(float(np.std(data)), 6)}))
`;
  const output = execSync(`python3 -c '${script}'`, { encoding: "utf-8" }).trim();
  return JSON.parse(output);
}

const silentHandler = (_event: StreamEvent) => {};

async function runMultiTurnTest(
  provider: ConversationOptions["provider"],
  expected: { mean: number; median: number; std: number }
) {
  const conv = new Conversation({ provider });
  await conv.send(TURN_1, silentHandler);
  const r2 = await conv.send(TURN_2, silentHandler);

  const parsed = parseResponse(r2.text);
  expect(parsed).not.toBeNull();

  const tol = 0.001;
  expect(Math.abs(parsed!.mean - expected.mean)).toBeLessThan(tol);
  expect(Math.abs(parsed!.median - expected.median)).toBeLessThan(tol);
  expect(Math.abs(parsed!.std - expected.std)).toBeLessThan(tol);
}

describe.skipIf(!HAS_ANTHROPIC)("Multi-turn file access — Claude", () => {
  it("should access files from previous turns", async () => {
    const expected = computeExpected();
    await runMultiTurnTest("anthropic", expected);
  });
});

describe.skipIf(!HAS_OPENAI)("Multi-turn file access — OpenAI", () => {
  it("should access files from previous turns", async () => {
    const expected = computeExpected();
    await runMultiTurnTest("openai", expected);
  });
});

describe.skipIf(!HAS_ANTHROPIC)("Conversation.send() — Anthropic code_output events", () => {
  it("should emit code_output via the multi-turn path", async () => {
    const conv = new Conversation({ provider: "anthropic" });
    const events: StreamEvent[] = [];

    await conv.send(
      "Write and run a Python script that prints 'CONV_OUTPUT_99'. Nothing else.",
      (event) => events.push(event)
    );

    const outputEvents = events.filter(e => e.type === "code_output");
    expect(outputEvents.length).toBeGreaterThan(0);
    expect(outputEvents.some(e => e.output?.includes("CONV_OUTPUT_99"))).toBe(true);
  });
});

describe("Multi-turn file access — Gemini", () => {
  it.skip("Gemini sandbox is ephemeral (no cross-turn file persistence)", () => {});
});
