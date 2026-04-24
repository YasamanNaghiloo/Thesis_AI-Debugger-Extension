import { OllamaProvider } from "../providers/OllamaProvider";
import {
  buildELI5Prompt,
  buildExplainErrorPrompt,
  buildReflectionPrompt
} from "../prompts/promptBuilders";

export class DebugAssistantService {
  private provider = new OllamaProvider();

  async explainError(
    error: string,
    code: string,
    repeatCount: number
  ): Promise<string> {
    const prompt =
      repeatCount >= 5
        ? buildELI5Prompt(error, code)
        : buildExplainErrorPrompt(error, code);

    return this.provider.ask(prompt);
  }

  async reflectSolved(): Promise<string> {
    return this.provider.ask(buildReflectionPrompt());
  }
}