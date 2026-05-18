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
      const startTime = Date.now();
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: "gemma3", prompt, stream: false }),
        signal: controller.signal
      });

      const elapsed = Date.now() - startTime;
      whybugInfo(`Ollama fetch completed in ${elapsed}ms`);

      if (!response.ok) {
        throw new Error("Could not connect to Ollama.");
      }

      const data: OllamaResponse = (await response.json()) as OllamaResponse;
      return data.response ?? "No response from model.";
    } catch (err: any) {
      if (err.name === 'AbortError') {
        whybugWarn(`Ollama request timed out after ${timeoutMs}ms.`);
        throw new Error(`Ollama request timed out after ${timeoutMs}ms. Try running your code again or check if Ollama is responsive.`);
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
