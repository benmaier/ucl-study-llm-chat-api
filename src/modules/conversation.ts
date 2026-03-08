/**
 * Unified Conversation class for multi-turn code execution
 *
 * Wraps Claude, OpenAI, and Gemini multi-turn functions behind a single interface.
 * Manages all provider-specific state (messages, responseId, containerId, contents) internally.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { GoogleGenAI } from "@google/genai";
import type {
  ConversationOptions,
  TurnResult,
  ConversationMessage,
  StreamEvent,
  SendOptions,
  UploadedFile,
  CodeExecutionFile,
} from "./types.js";
import {
  createAnthropicClient,
  executeCodeWithClaudeMultiTurn,
  uploadFile as uploadClaudeFile,
  uploadFileFromBuffer as uploadClaudeFileFromBuffer,
  deleteFile as deleteClaudeFile,
  downloadGeneratedFiles as downloadClaudeFiles,
} from "./anthropic-client.js";
import {
  createOpenAIClient,
  executeCodeWithOpenAIMultiTurn,
  uploadFile as uploadOpenAIFile,
  uploadFileFromBuffer as uploadOpenAIFileFromBuffer,
  deleteFile as deleteOpenAIFile,
  downloadGeneratedFiles as downloadOpenAIFiles,
} from "./openai-client.js";
import {
  createGeminiClient,
  executeCodeWithGeminiMultiTurn,
  uploadFile as uploadGeminiFile,
  uploadFileFromBuffer as uploadGeminiFileFromBuffer,
  deleteFile as deleteGeminiFile,
  downloadGeneratedFiles as downloadGeminiFiles,
} from "./gemini-client.js";

export class Conversation {
  private provider: "anthropic" | "openai" | "gemini";
  private model?: string;
  private maxTokens?: number;

  // Provider clients
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;
  private geminiClient?: GoogleGenAI;

  // Claude state
  private rawMessages: ConversationMessage[] = [];
  private containerId?: string;

  // OpenAI state
  private responseId?: string;

  // Gemini state
  private geminiContents: any[] = [];

  // Provider-agnostic text history
  private textHistory: { role: "user" | "assistant"; content: string }[] = [];

  constructor(options: ConversationOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.maxTokens = options.maxTokens;

    if (this.provider === "anthropic") {
      this.anthropicClient = createAnthropicClient(options.apiKey);
    } else if (this.provider === "gemini") {
      this.geminiClient = createGeminiClient(options.apiKey);
    } else {
      this.openaiClient = createOpenAIClient(options.apiKey);
    }
  }

  async uploadFile(filePath: string, mimeType?: string): Promise<UploadedFile> {
    if (this.provider === "anthropic") {
      return uploadClaudeFile(this.anthropicClient!, filePath, mimeType);
    } else if (this.provider === "gemini") {
      return uploadGeminiFile(this.geminiClient!, filePath, mimeType);
    } else {
      return uploadOpenAIFile(this.openaiClient!, filePath);
    }
  }

  async uploadFileFromBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string
  ): Promise<UploadedFile> {
    if (this.provider === "anthropic") {
      return uploadClaudeFileFromBuffer(this.anthropicClient!, buffer, filename, mimeType);
    } else if (this.provider === "gemini") {
      return uploadGeminiFileFromBuffer(this.geminiClient!, buffer, filename, mimeType);
    } else {
      return uploadOpenAIFileFromBuffer(this.openaiClient!, buffer, filename);
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    if (this.provider === "anthropic") {
      return deleteClaudeFile(this.anthropicClient!, fileId);
    } else if (this.provider === "gemini") {
      return deleteGeminiFile(this.geminiClient!, fileId);
    } else {
      return deleteOpenAIFile(this.openaiClient!, fileId);
    }
  }

  async send(
    message: string,
    onEvent: (event: StreamEvent) => void,
    options?: SendOptions
  ): Promise<TurnResult> {
    if (this.provider === "anthropic") {
      return this.sendClaude(message, onEvent, options);
    } else if (this.provider === "gemini") {
      return this.sendGemini(message, onEvent, options);
    } else {
      return this.sendOpenAI(message, onEvent, options);
    }
  }

  private async sendClaude(
    message: string,
    onEvent: (event: StreamEvent) => void,
    options?: SendOptions
  ): Promise<TurnResult> {
    const result = await executeCodeWithClaudeMultiTurn(
      this.anthropicClient!,
      message,
      onEvent,
      this.rawMessages.length > 0 ? this.rawMessages : undefined,
      {
        model: this.model,
        maxTokens: this.maxTokens,
        containerId: this.containerId,
        fileIds: options?.fileIds,
      }
    );

    // Update internal state
    this.rawMessages = result.messages;
    this.containerId = result.containerId;
    this.textHistory.push({ role: "user", content: message });
    this.textHistory.push({ role: "assistant", content: result.text });

    return {
      text: result.text,
      files: result.files,
      codeArtifacts: result.codeArtifacts,
    };
  }

  private async sendOpenAI(
    message: string,
    onEvent: (event: StreamEvent) => void,
    options?: SendOptions
  ): Promise<TurnResult> {
    const result = await executeCodeWithOpenAIMultiTurn(
      this.openaiClient!,
      message,
      onEvent,
      this.responseId,
      {
        model: this.model,
        maxTokens: this.maxTokens,
        fileIds: options?.fileIds,
      }
    );

    // Update internal state
    this.responseId = result.responseId;
    this.containerId = result.containerId;
    this.textHistory.push({ role: "user", content: message });
    this.textHistory.push({ role: "assistant", content: result.text });

    return {
      text: result.text,
      files: result.files,
      codeArtifacts: result.codeArtifacts,
    };
  }

  private async sendGemini(
    message: string,
    onEvent: (event: StreamEvent) => void,
    options?: SendOptions
  ): Promise<TurnResult> {
    const result = await executeCodeWithGeminiMultiTurn(
      this.geminiClient!,
      message,
      onEvent,
      this.geminiContents.length > 0 ? this.geminiContents : undefined,
      {
        model: this.model,
        maxTokens: this.maxTokens,
        fileIds: options?.fileIds,
      }
    );

    // Update internal state
    this.geminiContents = result.geminiContents || [];
    this.textHistory.push({ role: "user", content: message });
    this.textHistory.push({ role: "assistant", content: result.text });

    return {
      text: result.text,
      files: result.files,
      codeArtifacts: result.codeArtifacts,
    };
  }

  async downloadFiles(
    files: CodeExecutionFile[],
    outputDir: string = "."
  ): Promise<string[]> {
    if (this.provider === "anthropic") {
      return downloadClaudeFiles(this.anthropicClient!, files, outputDir);
    } else if (this.provider === "gemini") {
      return downloadGeminiFiles(files, outputDir);
    } else {
      return downloadOpenAIFiles(files, outputDir);
    }
  }

  getHistory(): { role: "user" | "assistant"; content: string }[] {
    return [...this.textHistory];
  }

  getProvider(): "anthropic" | "openai" | "gemini" {
    return this.provider;
  }
}
