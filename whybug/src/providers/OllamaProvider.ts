import { AIProvider } from "./AIProvider";

interface OllamaResponse {
  response?: string;
}

export class OllamaProvider implements AIProvider {
  // New per-call timeout-capable method
  async askWithTimeout(prompt: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
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
      return data.response ?? "No response from model.";
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error('Ollama request timed out.');
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
