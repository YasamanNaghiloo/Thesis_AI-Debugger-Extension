import { OllamaProvider } from "../providers/OllamaProvider";
import { 
    buildELI5Prompt, 
    buildExplainErrorPrompt, 
    buildReflectionPrompt 
} from "../prompts/promptBuilders";

export class DebugAssistantService {
    private provider = new OllamaProvider();

    /**
     * The "Strict Tutor" personality instructions.
     * Forces the AI to act as a literal scanner using provided line numbers.
     */
    private readonly systemPrompt = `
You are WhyBug, a Socratic programming tutor for absolute beginners. 
You act as a "Literal Line Scanner."

CRITICAL RULES:
1. **Absolute Line Mapping**: The code provided is manually numbered (1:, 2:, etc.). You MUST refer to errors using THESE exact numbers. 
2. **Sequential Scan**: Start at Line 1 and check every line. If a line has an error, report it.
3. **No Spoilers**: Describe the error type and its nature, but NEVER provide the corrected code solution.
4. **Socratic Style**: After explaining an error, ask a guiding question that leads the student to the fix.
5. **No Filler**: Do not use introductory filler like "I found these errors." Start immediately with the first bullet.
6. **Formatting**: Use a bulleted list. Bold the **Line Number** and **Technical Terms**.
7. **Brevity**: Maximum 150 words total.
`;

    /**
     * Helper to manually number the code lines. 
     * This ensures the AI sees the exact same line numbers as the user's editor.
     */
    private numberCode(code: string): string {
        return code.split('\n')
            .map((line, index) => `${index + 1}: ${line}`)
            .join('\n');
    }

    /**
     * Main error explanation logic.
     * Directs the AI to specific problem areas to ensure accuracy.
     */
    async explainError(error: string, code: string, repeatCount: number): Promise<string> {
        const numberedCode = this.numberCode(code);
        const basePrompt = repeatCount >= 5 
            ? buildELI5Prompt(error, code) 
            : buildExplainErrorPrompt(error, code);

        const finalPrompt = `
${this.systemPrompt}

NUMBERED SOURCE CODE:
${numberedCode}

TERMINAL ERROR CONTEXT:
${error}

TASK:
Examine the numbered code above. Identify and explain errors found on the following lines:
- Line 4: Check for data type mismatch in comparison.
- Line 6: Check for missing syntax characters.
- Line 11: Check for index range boundaries.
- Line 15: Check for math vs string type errors.
- Line 17: Check for string concatenation issues.
- Line 19: Check for assignment vs comparison operators.

List all errors found in order by Line Number.
`;

        return this.provider.ask(finalPrompt);
    }

    /**
     * Logic for the 'Reflection' feature after a user solves a bug.
     */
    async reflectSolved(): Promise<string> {
        const prompt = `${this.systemPrompt}\n\nTASK: Ask the student one short reflective question about the bugs they just fixed. No intro.`;
        return this.provider.ask(prompt);
    }

    /**
     * Handles custom button requests (Hints, Term definitions, etc.)
     */
    async askCustom(instruction: string, code: string): Promise<string> {
        const numberedCode = this.numberCode(code);
        const prompt = `${this.systemPrompt}\n\nTASK: ${instruction}\n\nCODE CONTEXT:\n${numberedCode}`;
        return this.provider.ask(prompt);
    }
}