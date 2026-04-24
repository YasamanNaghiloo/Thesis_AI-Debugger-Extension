import { OllamaProvider } from "../providers/OllamaProvider";
import {
    buildELI5Prompt,
    buildExplainErrorPrompt,
    buildReflectionPrompt
} from "../prompts/promptBuilders";

export class DebugAssistantService {
    private provider = new OllamaProvider();

    /**
     * Standard error explanation logic.
     * Automatically switches to ELI5 (Explain Like I'm 5) if the error repeat count is high.
     */
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

    /**
     * Logic for the 'Reflection' feature after a user solves a bug.
     */
    async reflectSolved(): Promise<string> {
        return this.provider.ask(buildReflectionPrompt());
    }

    /**
     * Handles custom button requests from the sidebar (Hints, Term definitions, etc.)
     */
    async askCustom(instruction: string, code: string): Promise<string> {
        const prompt = `
You are an AI debugging tutor for beginner programmers. 

TASK: 
${instruction}

CODE CONTEXT:
${code}

IMPORTANT RULES:
- Do NOT provide the corrected code solution.
- Use a supportive, encouraging tone.
- Guide the student to think for themselves.
- Keep the explanation simple and educational.
`;
        return this.provider.ask(prompt);
    }
}