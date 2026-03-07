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
  CodeExecutionFile,
} from "./types.js";
import {
  createAnthropicClient,
  executeCodeWithClaudeMultiTurn,
  downloadGeneratedFiles as downloadClaudeFiles,
} from "./anthropic-client.js";
import {
  createOpenAIClient,
  executeCodeWithOpenAIMultiTurn,
  downloadGeneratedFiles as downloadOpenAIFiles,
} from "./openai-client.js";
import {
  createGeminiClient,
  executeCodeWithGeminiMultiTurn,
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

  async send(
    message: string,
    onEvent: (event: StreamEvent) => void
  ): Promise<TurnResult> {
    if (this.provider === "anthropic") {
      return this.sendClaude(message, onEvent);
    } else if (this.provider === "gemini") {
      return this.sendGemini(message, onEvent);
    } else {
      return this.sendOpenAI(message, onEvent);
    }
  }

  private async sendClaude(
    message: string,
    onEvent: (event: StreamEvent) => void
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
    onEvent: (event: StreamEvent) => void
  ): Promise<TurnResult> {
    const result = await executeCodeWithOpenAIMultiTurn(
      this.openaiClient!,
      message,
      onEvent,
      this.responseId,
      {
        model: this.model,
        maxTokens: this.maxTokens,
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
    onEvent: (event: StreamEvent) => void
  ): Promise<TurnResult> {
    const result = await executeCodeWithGeminiMultiTurn(
      this.geminiClient!,
      message,
      onEvent,
      this.geminiContents.length > 0 ? this.geminiContents : undefined,
      {
        model: this.model,
        maxTokens: this.maxTokens,
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
