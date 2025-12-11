/**
 * Langfuse Session Tracking Module
 *
 * Provides simple functions for tracking LLM sessions and usage with Langfuse.
 * This is a lightweight implementation that can be used without the full SDK v4.
 *
 * Note: For production use, consider using the full @langfuse/tracing SDK
 */

// Types
export interface LangfuseConfig {
  secretKey: string;
  publicKey: string;
  baseUrl?: string;
}

export interface TraceParams {
  id?: string;
  name: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface SpanParams {
  traceId: string;
  name: string;
  input?: any;
  output?: any;
  metadata?: Record<string, any>;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  startTime?: Date;
  endTime?: Date;
}

export interface ScoreParams {
  traceId: string;
  name: string;
  value: number | string;
  comment?: string;
}

/**
 * Simple Langfuse client for tracking
 */
export class LangfuseClient {
  private config: LangfuseConfig;
  private baseUrl: string;

  constructor(config?: Partial<LangfuseConfig>) {
    this.config = {
      secretKey: config?.secretKey || process.env.LANGFUSE_SECRET_KEY || "",
      publicKey: config?.publicKey || process.env.LANGFUSE_PUBLIC_KEY || "",
      baseUrl: config?.baseUrl || process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
    };
    this.baseUrl = this.config.baseUrl || "https://cloud.langfuse.com";
  }

  private getAuthHeader(): string {
    const credentials = `${this.config.publicKey}:${this.config.secretKey}`;
    return `Basic ${Buffer.from(credentials).toString("base64")}`;
  }

  private async apiCall(endpoint: string, data: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/public${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Langfuse API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Create a new trace
   */
  async createTrace(params: TraceParams): Promise<string> {
    const traceId = params.id || `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await this.apiCall("/traces", {
      id: traceId,
      name: params.name,
      sessionId: params.sessionId,
      userId: params.userId,
      metadata: params.metadata,
      tags: params.tags,
      timestamp: new Date().toISOString(),
    });

    return traceId;
  }

  /**
   * Create a generation (LLM call) span
   */
  async createGeneration(params: SpanParams): Promise<string> {
    const generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await this.apiCall("/generations", {
      id: generationId,
      traceId: params.traceId,
      name: params.name,
      input: params.input,
      output: params.output,
      metadata: params.metadata,
      model: params.model,
      usage: {
        input: params.inputTokens,
        output: params.outputTokens,
      },
      startTime: (params.startTime || new Date()).toISOString(),
      endTime: (params.endTime || new Date()).toISOString(),
    });

    return generationId;
  }

  /**
   * Add a score to a trace
   */
  async createScore(params: ScoreParams): Promise<void> {
    await this.apiCall("/scores", {
      traceId: params.traceId,
      name: params.name,
      value: params.value,
      comment: params.comment,
    });
  }

  /**
   * Flush pending events (for SDKs that batch events)
   */
  async flush(): Promise<void> {
    // This simple implementation sends immediately, so nothing to flush
  }
}

/**
 * Create a Langfuse client
 */
export function createLangfuseClient(config?: Partial<LangfuseConfig>): LangfuseClient {
  return new LangfuseClient(config);
}

/**
 * Session tracker for managing conversation sessions
 */
export class SessionTracker {
  private client: LangfuseClient;
  private sessionId: string;
  private userId: string;
  private traceIds: string[] = [];

  constructor(client: LangfuseClient, userId: string, sessionId?: string) {
    this.client = client;
    this.userId = userId;
    this.sessionId = sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getUserId(): string {
    return this.userId;
  }

  /**
   * Track an LLM call
   */
  async trackLLMCall(params: {
    name: string;
    input: string;
    output: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    metadata?: Record<string, any>;
    tags?: string[];
    durationMs?: number;
  }): Promise<string> {
    const startTime = new Date(Date.now() - (params.durationMs || 0));
    const endTime = new Date();

    // Create trace
    const traceId = await this.client.createTrace({
      name: params.name,
      sessionId: this.sessionId,
      userId: this.userId,
      metadata: params.metadata,
      tags: params.tags,
    });

    this.traceIds.push(traceId);

    // Create generation span
    await this.client.createGeneration({
      traceId,
      name: `${params.name}-generation`,
      input: params.input,
      output: params.output,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      startTime,
      endTime,
    });

    return traceId;
  }

  /**
   * Add feedback to a trace
   */
  async addFeedback(traceId: string, score: number, comment?: string): Promise<void> {
    await this.client.createScore({
      traceId,
      name: "user-feedback",
      value: score,
      comment,
    });
  }

  /**
   * Get all trace IDs for this session
   */
  getTraceIds(): string[] {
    return [...this.traceIds];
  }
}

/**
 * Create a session tracker
 */
export function createSessionTracker(
  client: LangfuseClient,
  userId: string,
  sessionId?: string
): SessionTracker {
  return new SessionTracker(client, userId, sessionId);
}

/**
 * Helper to wrap an LLM call with tracking
 */
export async function withTracking<T>(
  tracker: SessionTracker,
  name: string,
  model: string,
  input: string,
  fn: () => Promise<{ output: string; inputTokens?: number; outputTokens?: number }>
): Promise<{ result: T; traceId: string }> {
  const startTime = Date.now();

  const { output, inputTokens, outputTokens } = await fn();

  const traceId = await tracker.trackLLMCall({
    name,
    input,
    output,
    model,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - startTime,
  });

  return { result: output as T, traceId };
}
