// Simple rate limiter for Gemini API calls.
// Ensures minimum gap between requests to avoid 429/TPM issues.
// With subject screening, most runs make very few API calls so this is mostly a safety net.

const MIN_INTERVAL_MS = 1000;
let lastCallTime = 0;

export async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
  }
  lastCallTime = Date.now();
}

/**
 * Wraps an async function with rate limiting, retry logic for 429 and 503 errors.
 * - 429 (rate limit): retries with exponential backoff
 * - 503 (overloaded): retries with longer backoff, then falls back to alternate model
 * @param fn - Primary model call
 * @param fallbackFn - Optional fallback model call (used when primary returns 503 after retries)
 */
export async function withRateLimit<T>(
  fn: () => Promise<T>,
  fallbackFn?: () => Promise<T>,
): Promise<T> {
  const maxRetries = 4;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await waitForRateLimit();
    try {
      return await fn();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const is429 = message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('rate limit');
      const is503 = message.includes('503') || message.includes('overloaded') || message.includes('high demand') || message.includes('Service Unavailable');

      if (is429 && attempt < maxRetries) {
        const backoff = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s, 16s
        console.warn(`Rate limited (attempt ${attempt + 1}/${maxRetries}), waiting ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      if (is503 && attempt < maxRetries) {
        const backoff = Math.pow(2, attempt + 1) * 2000; // 4s, 8s, 16s, 32s
        console.warn(`Model overloaded 503 (attempt ${attempt + 1}/${maxRetries}), waiting ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      // All retries exhausted — try fallback model if available
      if ((is429 || is503 || message.includes('fetch failed')) && fallbackFn) {
        console.warn(`Primary model failed after ${maxRetries + 1} attempts (${is429 ? '429' : is503 ? '503' : 'network'}), falling back to alternate model...`);
        await waitForRateLimit();
        return await fallbackFn();
      }

      throw e;
    }
  }

  throw new Error('Rate limit retries exhausted');
}
