/**
 * Unified Types for Code Execution Modules
 *
 * These interfaces are shared between Claude and OpenAI modules
 * to provide a consistent API for frontend integration.
 */

/**
 * Represents an uploaded file that can be referenced in code execution
 */
export interface UploadedFile {
  file_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

/**
 * Represents a file generated during code execution (images, data files, etc.)
 */
export interface CodeExecutionFile {
  file_id: string;
  filename: string;
  container_id?: string; // OpenAI only
}

/**
 * Represents source code created/executed during code execution
 */
export interface CodeArtifact {
  id: string;       // Unique identifier
  path: string;     // File path (e.g., "plot.py") or "code_interpreter" for OpenAI
  code: string;     // Full source code
  language: string; // Programming language (e.g., "python")
}

/**
 * The complete result returned after code execution
 */
export interface CodeExecutionResult {
  text: string;                  // Model's text response
  files: CodeExecutionFile[];    // Generated files (images, etc.)
  codeArtifacts: CodeArtifact[]; // Source code files created/executed
  containerId?: string;          // Container ID for follow-up requests
}

/**
 * Events emitted during streaming execution
 */
export interface StreamEvent {
  type: StreamEventType;
  text?: string;      // Text content (for "text" type)
  code?: string;      // Code content (for "code" and "code_complete" types)
  toolName?: string;  // Tool name (for "tool_start" and "tool_end" types)
}

/**
 * Possible stream event types
 */
export type StreamEventType =
  | "text"           // Text response streaming
  | "tool_start"     // Code execution tool started
  | "tool_input"     // Tool input streaming (Claude only)
  | "code"           // Code streaming (OpenAI only)
  | "code_executing" // Code is being executed
  | "code_complete"  // Code execution complete
  | "tool_end";      // Code execution tool ended

/**
 * Options for code execution
 */
export interface CodeExecutionOptions {
  model?: string;
  maxTokens?: number;
  containerId?: string; // For continuing in same container (Claude only)
  fileIds?: string[];   // File IDs to make available for code execution
}

/**
 * Options for simple chat
 */
export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
}

/**
 * A message in a multi-turn conversation (provider-agnostic)
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Result from a multi-turn code execution, including the updated conversation history
 */
export interface MultiTurnCodeResult extends CodeExecutionResult {
  /** Updated messages array including the assistant's response — pass back for next turn */
  messages: ConversationMessage[];
  /** For OpenAI Responses API: the response ID to chain with previous_response_id */
  responseId?: string;
}
