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
  executeCodeWithClaudeMultiTurn,
  downloadGeneratedFiles as downloadClaudeFiles,
  chatWithClaude,
  streamChatWithClaude,
} from "./modules/anthropic-client.js";

// Export OpenAI client functions
export {
  createOpenAIClient,
  uploadFile as uploadOpenAIFile,
  uploadFileFromBuffer as uploadOpenAIFileFromBuffer,
  deleteFile as deleteOpenAIFile,
  executeCodeWithOpenAI,
  executeCodeWithOpenAIStreaming,
  executeCodeWithOpenAIMultiTurn,
  downloadGeneratedFiles as downloadOpenAIFiles,
  chatWithOpenAI,
  streamChatWithOpenAI,
} from "./modules/openai-client.js";

// Export Gemini client functions
export {
  createGeminiClient,
  uploadFile as uploadGeminiFile,
  uploadFileFromBuffer as uploadGeminiFileFromBuffer,
  deleteFile as deleteGeminiFile,
  executeCodeWithGemini,
  executeCodeWithGeminiStreaming,
  executeCodeWithGeminiMultiTurn,
  downloadGeneratedFiles as downloadGeminiFiles,
  chatWithGemini,
  streamChatWithGemini,
} from "./modules/gemini-client.js";

// Export Conversation class
export { Conversation } from "./modules/conversation.js";

// Export Langfuse client
export * from "./modules/langfuse-client.js";

// Export Key Pool
export * from "./modules/key-pool.js";
