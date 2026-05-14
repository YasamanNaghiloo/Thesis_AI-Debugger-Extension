import { AIProvider } from "./AIProvider";
import { whybugInfo, whybugWarn } from "../services/logger";

interface OllamaResponse {
  response?: string;
}

export class OllamaProvider implements AIProvider {
  // New per-call timeout-capable method
  async askWithTimeout(prompt: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      whybugInfo('Ollama askWithTimeout called. prompt length:', prompt?.length ?? 0, 'timeoutMs:', timeoutMs);
      const preview = typeof prompt === 'string' && prompt.length > 1200 ? prompt.slice(0, 1200) + '\n...<truncated>...' : prompt;
      whybugInfo('Ollama prompt preview:\n', preview);

      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: "gemma3", prompt, stream: false }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error("Could not connect to Ollama.");
      }

      const data: OllamaResponse = (await response.json()) as OllamaResponse;
      const rpreview = typeof data.response === 'string' && data.response.length > 1200 ? data.response.slice(0, 1200) + '\n...<truncated>...' : data.response;
      whybugInfo('Ollama model response length:', data.response?.length ?? 0);
      whybugInfo('Ollama model response preview:\n', rpreview);
      return data.response ?? "No response from model.";
    } catch (err: any) {
      if (err.name === 'AbortError') {
        whybugWarn('Ollama request timed out.');
        throw new Error('Ollama request timed out.');
      }
      whybugWarn('Ollama askWithTimeout error:', err?.message ?? err);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Backwards-compatible ask defaulting to 20s timeout for interactive buttons
  async ask(prompt: string): Promise<string> {
    return this.askWithTimeout(prompt, 20000);
  }
 }
