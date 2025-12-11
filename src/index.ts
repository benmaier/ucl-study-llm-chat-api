/**
 * Test Native APIs - Main Export
 *
 * Modules for interacting with Claude and OpenAI APIs
 * with code execution capabilities.
 */

// Export shared types
export * from "./modules/types.js";

// Export Anthropic client functions
export {
  createAnthropicClient,
  executeCodeWithClaude,
  executeCodeWithClaudeStreaming,
  downloadGeneratedFiles as downloadClaudeFiles,
  chatWithClaude,
  streamChatWithClaude,
} from "./modules/anthropic-client.js";

// Export OpenAI client functions
export {
  createOpenAIClient,
  executeCodeWithOpenAI,
  executeCodeWithOpenAIStreaming,
  downloadGeneratedFiles as downloadOpenAIFiles,
  chatWithOpenAI,
  streamChatWithOpenAI,
} from "./modules/openai-client.js";

// Export Langfuse client
export * from "./modules/langfuse-client.js";
