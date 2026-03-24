// Gemini model pricing per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
};

export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const prices = PRICING[model] ?? PRICING['gemini-3-flash-preview'];
  return (promptTokens * prices.input + completionTokens * prices.output) / 1_000_000;
}
