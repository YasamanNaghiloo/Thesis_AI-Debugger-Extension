import { AIProvider } from "./AIProvider";

interface OllamaResponse {
  response?: string;
}

export class OllamaProvider implements AIProvider {
  async ask(prompt: string): Promise<string> {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gemma3",
        prompt,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error("Could not connect to Ollama.");
    }

    const data: OllamaResponse =
      (await response.json()) as OllamaResponse;

    return data.response ?? "No response from model.";
  }
}