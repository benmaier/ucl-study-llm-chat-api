/**
 * Debug Test: OpenAI Responses API raw events
 */

import "dotenv/config";
import OpenAI from "openai";

const TEST_PROMPT = `Create a simple plot of y = x^2 and save it as plot.png.`;

async function main() {
  console.log("Testing OpenAI Responses API raw events...\n");

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const stream = await client.responses.create({
    model: "gpt-4o",
    input: TEST_PROMPT,
    tools: [
      {
        type: "code_interpreter",
        container: { type: "auto" },
      },
    ],
    stream: true,
  });

  console.log("--- Raw Events ---\n");

  let eventCount = 0;
  let fullResponse: any = null;

  for await (const event of stream as AsyncIterable<any>) {
    eventCount++;
    console.log(`[${eventCount}] Event type: ${event.type}`);

    // Log interesting event details
    if (event.type === "response.output_text.delta") {
      // Check all possible text field locations
      console.log(`    raw event keys: ${Object.keys(event).join(", ")}`);
      console.log(`    delta: "${event.delta}"`);
    } else if (event.type === "response.code_interpreter_call_code.delta") {
      console.log(`    code delta: "${(event.delta || event.code || "").slice(0, 50)}..."`);
    } else if (event.type === "response.code_interpreter_call_code.done") {
      console.log(`    code done: "${(event.code || "").slice(0, 100)}..."`);
    } else if (event.type === "response.output_item.added") {
      console.log(`    item: ${JSON.stringify(event.item?.type || event)}`);
    } else if (event.type === "response.content_part.added") {
      console.log(`    content_part: ${JSON.stringify(event.part?.type || event)}`);
    } else if (event.type === "response.output_text.annotation.added") {
      console.log(`    ANNOTATION: ${JSON.stringify(event.annotation || event)}`);
    } else if (event.type === "response.done" || event.type === "response.completed") {
      fullResponse = event.response;
      console.log(`    response id: ${event.response?.id}`);
    }
  }

  console.log(`\n--- Total events: ${eventCount} ---\n`);

  if (fullResponse) {
    console.log("--- Full Response Structure ---\n");
    console.log("Response ID:", fullResponse.id);
    console.log("Status:", fullResponse.status);
    console.log("Output items:", fullResponse.output?.length || 0);

    if (fullResponse.output) {
      for (let i = 0; i < fullResponse.output.length; i++) {
        const item = fullResponse.output[i];
        console.log(`\n[Output ${i}] type: ${item.type}`);

        if (item.type === "code_interpreter_call") {
          console.log("  id:", item.id);
          console.log("  status:", item.status);
          console.log("  code:", item.code?.slice(0, 200) + "...");
          console.log("  results:", JSON.stringify(item.results)?.slice(0, 200));
          console.log("  container_id:", item.container_id);
        } else if (item.type === "message") {
          console.log("  role:", item.role);
          console.log("  content items:", item.content?.length || 0);

          for (const content of item.content || []) {
            console.log(`    content type: ${content.type}`);
            if (content.type === "output_text") {
              console.log(`    text: ${content.text?.slice(0, 200)}...`);
            }
            if (content.annotations) {
              console.log(`    annotations: ${JSON.stringify(content.annotations)}`);
            }
          }
        }
      }
    }
  }
}

main();
