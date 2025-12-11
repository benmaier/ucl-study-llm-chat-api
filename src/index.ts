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
  uploadFile as uploadClaudeFile,
  uploadFileFromBuffer as uploadClaudeFileFromBuffer,
  deleteFile as deleteClaudeFile,
  executeCodeWithClaude,
  executeCodeWithClaudeStreaming,
  downloadGeneratedFiles as downloadClaudeFiles,
  chatWithClaude,
  streamChatWithClaude,
} from "./modules/anthropic-client.js";

// Export OpenAI client functions
export {
  createOpenAIClient,
  createContainer as createOpenAIContainer,
  uploadFile as uploadOpenAIFile,
  uploadFileFromBuffer as uploadOpenAIFileFromBuffer,
  deleteFile as deleteOpenAIFile,
  executeCodeWithOpenAI,
  executeCodeWithOpenAIStreaming,
  downloadGeneratedFiles as downloadOpenAIFiles,
  chatWithOpenAI,
  streamChatWithOpenAI,
} from "./modules/openai-client.js";

// Export Langfuse client
export * from "./modules/langfuse-client.js";
