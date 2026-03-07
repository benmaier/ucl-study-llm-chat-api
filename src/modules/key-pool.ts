/**
 * Key Pool Module
 *
 * Fetches API keys from the Scaleway PostgreSQL database at login.
 * Keys are organized into per-condition pools and load-balanced
 * by assigning the least-used key via a SECURITY DEFINER function.
 */

import type { Pool } from "pg";

export type Provider = "anthropic" | "openai" | "gemini";

interface AssignedKey {
  provider: Provider;
  apiKey: string;
  apiKeyId: number;
}

interface ConditionInfo {
  id: number;
  name: string;
}

export class KeyPool {
  private dbPool: Pool;
  private assignedKeys: Map<Provider, AssignedKey> = new Map();
  private condition: ConditionInfo | null = null;

  constructor(dbPool: Pool) {
    this.dbPool = dbPool;
  }

  /**
   * Fetch and cache API keys for the given providers.
   * Calls the `assign_api_key()` DB function which:
   * - Looks up the participant's condition via current_user + tokens table
   * - Finds the least-used active key for that provider in the condition's pool
   * - Increments session_assignment_count
   * - Logs the assignment
   * - Returns the API key string
   */
  async fetchKeys(providers?: Provider[]): Promise<void> {
    const toFetch = providers || (["anthropic", "openai", "gemini"] as Provider[]);

    // Fetch condition info if not already cached
    if (!this.condition) {
      const condResult = await this.dbPool.query(
        `SELECT ec.id, ec.name
         FROM tokens t
         JOIN experiment_conditions ec ON ec.id = t.condition_id
         WHERE t.db_user = current_user AND t.is_active = true
         LIMIT 1`
      );
      if (condResult.rows.length > 0) {
        this.condition = {
          id: condResult.rows[0].id,
          name: condResult.rows[0].name,
        };
      }
    }

    // Fetch keys for each provider via the SECURITY DEFINER function
    for (const provider of toFetch) {
      try {
        const result = await this.dbPool.query(
          "SELECT assign_api_key($1) AS api_key",
          [provider]
        );
        if (result.rows.length > 0 && result.rows[0].api_key) {
          this.assignedKeys.set(provider, {
            provider,
            apiKey: result.rows[0].api_key,
            apiKeyId: 0, // ID is internal to the DB function
          });
        }
      } catch (error) {
        // Provider may not be available for this condition — skip
        console.warn(`Could not fetch ${provider} key:`, error);
      }
    }
  }

  /**
   * Get the cached API key for a provider.
   * Returns undefined if no key is assigned for that provider.
   */
  getKey(provider: Provider): string | undefined {
    return this.assignedKeys.get(provider)?.apiKey;
  }

  /**
   * Returns the list of providers for which keys have been assigned.
   */
  getAvailableProviders(): Provider[] {
    return Array.from(this.assignedKeys.keys());
  }

  /**
   * Mid-session fallback: fetch a key for a different provider.
   * Useful if one API becomes unreachable.
   */
  async switchProvider(toProvider: Provider): Promise<string | undefined> {
    if (!this.assignedKeys.has(toProvider)) {
      await this.fetchKeys([toProvider]);
    }
    return this.getKey(toProvider);
  }

  /**
   * Returns the participant's experiment condition, or null if not yet fetched.
   */
  getCondition(): ConditionInfo | null {
    return this.condition;
  }
}

/**
 * Factory function to create a KeyPool instance.
 */
export function createKeyPool(dbPool: Pool): KeyPool {
  return new KeyPool(dbPool);
}
