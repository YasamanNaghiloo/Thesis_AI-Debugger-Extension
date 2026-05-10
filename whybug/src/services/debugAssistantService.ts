import * as vscode from "vscode";
import { OllamaProvider } from "../providers/OllamaProvider";
import { 
    buildExplainErrorPrompt, 
    buildReflectionPrompt 
} from "../prompts/promptBuilders";
import { getHybridErrorScore } from "./errorAdaptation";

export interface ErrorAnalytics {
    errorType: string;
    recentCount: number;
    totalScore: number;
    currentLevel: number;
    lastSeenMs: number;
}

interface ErrorState {
    timestamps: number[];
    currentLevel: number;
    lastSeenMs: number;
}

export class DebugAssistantService {
    private provider = new OllamaProvider();
    private context?: vscode.ExtensionContext;

    // Adaptive prompt configuration (in milliseconds)
    private readonly WINDOW_MS = 7 * 24 * 60 * 60 * 1000;       // 7 days
    private readonly HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;  // 14 days
    private readonly MAX_TIMESTAMPS = 100;                      // cap storage

    // Level thresholds: score < t0 → L0, t0 ≤ score < t1 → L1, score ≥ t1 → L2
    private readonly LEVEL_THRESHOLDS = {
        l1: 1.5,
        l2: 4.0
    };

    // Per-error state: errorType → { timestamps, currentLevel, lastSeenMs }
    private errorState: Map<string, ErrorState> = new Map();

    constructor(context?: vscode.ExtensionContext) {
        this.context = context;
        if (this.context) this.loadPersistedState();
    }

    private readonly errorTypeDefinitions: Record<string, { definition: string; context: string }> = {
        TypeError: {
            definition: "This error occurs when an operation is used with an incompatible data type.",
            context: "In practice, your code is combining or calling values in a way their types do not support."
        },
        ValueError: {
            definition: "This error occurs when a value has the right type but an invalid value.",
            context: "In practice, the operation is valid, but the specific input is outside accepted rules."
        },
        IndexError: {
            definition: "This error occurs when code tries to access a list or sequence index that is out of range.",
            context: "In practice, your code is requesting a position that does not exist in that sequence."
        },
        KeyError: {
            definition: "This error occurs when a dictionary key is requested but does not exist.",
            context: "In practice, your code expected a key that is missing from the dictionary."
        },
        NameError: {
            definition: "This error occurs when a variable or function name is used before it is defined.",
            context: "In practice, Python cannot find that name in the current scope."
        },
        AttributeError: {
            definition: "This error occurs when code tries to access an attribute or method that an object does not have.",
            context: "In practice, that object type does not support the attribute name being used."
        },
        ZeroDivisionError: {
            definition: "This error occurs when code attempts to divide by zero.",
            context: "In practice, a denominator became 0 at runtime."
        },
        FileNotFoundError: {
            definition: "This error occurs when code tries to open a file path that does not exist.",
            context: "In practice, the path is wrong, missing, or not reachable from where the program runs."
        },
        RuntimeError: {
            definition: "This error indicates a generic runtime failure during program execution.",
            context: "In practice, something went wrong while running, even though syntax looked valid."
        },
        SyntaxError: {
            definition: "This error occurs when code has invalid syntax and cannot be parsed.",
            context: "In practice, Python cannot interpret the structure of the statement."
        },
        ModuleNotFoundError: {
            definition: "This error occurs when Python cannot find the module being imported.",
            context: "In practice, the module is not installed or not in the import path."
        },
        ImportError: {
            definition: "This error occurs when an import statement fails to load a name or module.",
            context: "In practice, the module exists, but the specific import target cannot be loaded."
        },
        AssertionError: {
            definition: "This error occurs when an assert statement evaluates to false.",
            context: "In practice, a condition you expected to be true was not true at runtime."
        },
        OverflowError: {
            definition: "This error occurs when a numeric operation exceeds supported limits.",
            context: "In practice, the result is too large for that numeric operation."
        },
        MemoryError: {
            definition: "This error occurs when an operation runs out of available memory.",
            context: "In practice, the program tried to allocate more memory than available."
        },
        RecursionError: {
            definition: "This error occurs when maximum recursion depth is exceeded.",
            context: "In practice, a recursive function kept calling itself too deeply."
        },
        OSError: {
            definition: "This error indicates an operating system related failure, such as file or device issues.",
            context: "In practice, the environment or OS-level resource blocked the operation."
        },
        PermissionError: {
            definition: "This error occurs when code lacks permission to access a resource.",
            context: "In practice, your process is not allowed to read, write, or execute that target."
        },
        TimeoutError: {
            definition: "This error occurs when an operation exceeds the allowed time limit.",
            context: "In practice, the operation took too long and was stopped."
        },
        ConnectionError: {
            definition: "This error occurs when a network connection operation fails.",
            context: "In practice, the program could not establish or keep a network connection."
        }
    };

    private readonly errorTypeAliases: Record<string, string> = {
        UnicodeDecodeError: "ValueError",
        UnicodeEncodeError: "ValueError",
        FloatingPointError: "ArithmeticError",
        ArithmeticError: "RuntimeError",
        EnvironmentError: "OSError",
        IOError: "OSError",
        WindowsError: "OSError"
    };

    /**
     * Extract the error type from a full error message.
     * E.g., "TypeError: unsupported operand type(s)" → "TypeError"
     */
    private extractErrorType(errorMessage: string): string {
        const match = errorMessage.match(/^([A-Za-z]+Error|[A-Za-z]+Exception|[A-Za-z]+Warning)/);
        return match ? match[0] : "Error";
    }

    /**
     * Get the canonical error type (map aliases to their base type).
     */
    private getCanonicalErrorType(errorType: string): string {
        return this.errorTypeAliases[errorType] || errorType;
    }

    /**
     * Update error state when an error is encountered.
     * Records a timestamp for this error type and recomputes its level.
     */
    private updateErrorState(errorType: string, nowMs: number = Date.now()): void {
        const canonical = this.getCanonicalErrorType(errorType);
        let state = this.errorState.get(canonical);
        if (!state) {
            state = { timestamps: [], currentLevel: 0, lastSeenMs: nowMs };
            this.errorState.set(canonical, state);
        }

        state.timestamps.push(nowMs);
        state.lastSeenMs = nowMs;

        // Cap the stored timestamps to avoid unbounded growth
        if (state.timestamps.length > this.MAX_TIMESTAMPS) {
            state.timestamps = state.timestamps.slice(-this.MAX_TIMESTAMPS);
        }

        // Recompute level based on updated score
        state.currentLevel = this.computeLevel(canonical);
        // Persist updated state
        try {
            void this.savePersistedState();
        } catch (e) {
            console.warn("Failed to persist error state", e);
        }
    }

    private loadPersistedState(): void {
        if (!this.context) return;
        try {
            const raw = this.context.workspaceState.get<Record<string, any>>("whybug.errorState", {});
            for (const [key, value] of Object.entries(raw || {})) {
                const timestamps = Array.isArray(value.timestamps) ? value.timestamps.filter((t: any) => Number.isFinite(t)).map((t: any) => Number(t)) : [];
                const currentLevel = typeof value.currentLevel === 'number' ? value.currentLevel : 0;
                const lastSeenMs = typeof value.lastSeenMs === 'number' ? value.lastSeenMs : 0;
                this.errorState.set(key, { timestamps, currentLevel, lastSeenMs });
            }
        } catch (err) {
            console.warn("Failed to load persisted error state", err);
        }
    }

    private async savePersistedState(): Promise<void> {
        if (!this.context) return;
        const serializable: Record<string, any> = {};
        for (const [key, state] of this.errorState.entries()) {
            serializable[key] = {
                timestamps: state.timestamps,
                currentLevel: state.currentLevel,
                lastSeenMs: state.lastSeenMs
            };
        }

        try {
            await this.context.workspaceState.update("whybug.errorState", serializable);
        } catch (err) {
            console.warn("Failed to save persisted error state", err);
        }
    }

    /**
     * Compute the prompt level (0, 1, or 2) for an error type based on its score.
     */
    private computeLevel(canonicalErrorType: string): number {
        const state = this.errorState.get(canonicalErrorType);
        if (!state) return 0;

        const score = getHybridErrorScore(state.timestamps, {
            windowMs: this.WINDOW_MS,
            halfLifeMs: this.HALF_LIFE_MS,
            nowMs: Date.now()
        });

        if (score >= this.LEVEL_THRESHOLDS.l2) return 2;
        if (score >= this.LEVEL_THRESHOLDS.l1) return 1;
        return 0;
    }

    /**
     * Get analytics for all tracked error types.
     */
    public getErrorAnalytics(): ErrorAnalytics[] {
        const results: ErrorAnalytics[] = [];

        for (const [errorType, state] of this.errorState.entries()) {
            const breakdown = getHybridErrorScore(state.timestamps, {
                windowMs: this.WINDOW_MS,
                halfLifeMs: this.HALF_LIFE_MS,
                nowMs: Date.now()
            });

            results.push({
                errorType,
                recentCount: state.timestamps.filter(
                    ts => Date.now() - ts <= this.WINDOW_MS
                ).length,
                totalScore: breakdown,
                currentLevel: state.currentLevel,
                lastSeenMs: state.lastSeenMs
            });
        }

        // Sort by most recent first
        return results.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
    }

    /**
     * For testing/debugging: manually record an error occurrence.
     */
    public recordErrorForTesting(errorType: string): void {
        console.log(`[DebugAssistantService] MANUAL TEST: Recording error ${errorType}`);
        this.updateErrorState(errorType);
        const analytics = this.getErrorAnalytics();
        console.log(`[DebugAssistantService] Updated error state. Current analytics:`, analytics);
    }

    /**
     * Explain multiple error types (from console output).
     * One bullet per error type, generic explanation only.
     */
    async explainErrorTypes(errorTypes: string[]): Promise<string> {
        if (errorTypes.length === 0) return "No recognizable errors found.";
        
        const errorList = errorTypes.map(e => `• ${e}`).join("\n");
        
        const prompt = `You are WhyBug, a debugging tutor.

For each error type listed below, provide ONE sentence explaining what that error type means. Be generic—do NOT reference any specific code or error message.

ERROR TYPES TO EXPLAIN:
${errorList}

TASK: For each error type, provide one bullet point with a generic explanation.

Format:
• **ErrorType**: Brief generic explanation of what this error means.

Now explain the errors:`;

        return this.provider.ask(prompt);
    }

    extractErrorEntriesFromTerminalOutput(terminalOutput: string): Array<{ errorType: string; message: string }> {
        if (!terminalOutput || terminalOutput.trim().length === 0) {
            console.log("[DebugAssistantService] No terminal output to parse");
            return [];
        }

        console.log("[DebugAssistantService] Parsing terminal output for errors...");
        const lines = terminalOutput.split(/\r?\n/);
        const errorPattern = /([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception|Warning))\s*:\s*(.*)$/;
        const entries: Array<{ errorType: string; message: string }> = [];

        for (const line of lines) {
            const match = line.match(errorPattern);
            if (!match) continue;

            const errorType = match[1];
            const message = match[2].trim();
            console.log(`[DebugAssistantService] Found error: ${errorType}`);
            entries.push({ errorType, message });
            this.updateErrorState(errorType);
        }

        console.log(`[DebugAssistantService] Extracted ${entries.length} error entries`);

        const deduped = new Map<string, { errorType: string; message: string }>();
        for (const entry of entries) {
            deduped.set(entry.errorType, entry);
        }

        return [...deduped.values()];
    }

    private formatContextFromMessage(errorType: string, message: string): string {
        const cleanMessage = message.trim();

        if (errorType === "SyntaxError") {
            if (cleanMessage) {
                return `Here, the traceback (the error report Python prints) says ${cleanMessage}. That means Python was reading your code and found a statement that was not finished or not written in a way it could understand.`;
            }

            return "In practice, Python was reading your code and found a statement that was not finished or not written in a way it could understand.";
        }

        if (errorType === "TypeError") {
            if (cleanMessage) {
                return `Here, the traceback (the error report Python prints) says ${cleanMessage}. That means Python tried to do something with values that do not fit together for that operation.`;
            }

            return "In practice, Python tried to do something with values that do not fit together for that operation.";
        }

        if (cleanMessage) {
            return `In this traceback, the message is ${cleanMessage}, which points to this specific kind of problem.`;
        }

        return "In practice, the problem is tied to this specific error category.";
    }

    explainErrorEntriesDeterministic(errorEntries: Array<{ errorType: string; message: string }>): string {
        if (errorEntries.length === 0) {
            return "• No recognizable error types found in terminal output.";
        }

        return errorEntries
            .map(({ errorType, message }) => {
                const canonicalType = this.errorTypeAliases[errorType] || errorType;
                const info = this.errorTypeDefinitions[canonicalType];
                if (info) {
                    return `• **${errorType}**: ${info.definition} ${this.formatContextFromMessage(errorType, message)}`;
                }
                return `• **${errorType}**: This indicates a runtime error of this type during program execution. ${this.formatContextFromMessage(errorType, message)}`;
            })
            .join("\n");
    }

    /**
     * Main error explanation logic.
     * Extracts error type from a single error message.
     */
    async explainError(error: string): Promise<string> {
        const errorType = this.extractErrorType(error);
        this.updateErrorState(errorType);
        
        const prompt = `Explain what a **${errorType}** is in one sentence. Do NOT provide code examples. Do NOT be specific to the error message. Just explain the error type itself.

Format:
• **${errorType}**: Generic explanation of what this error means.`;

        return this.provider.ask(prompt);
    }

    /**
     * Explain errors from raw terminal output.
     * Let the AI parse the terminal output and extract/explain errors.
     */
    async explainTerminalOutput(terminalOutput: string): Promise<string> {
        if (!terminalOutput || terminalOutput.trim().length === 0) {
            return "• **Error**: No terminal output captured. Unable to identify errors.";
        }

        const prompt = `CRITICAL: You MUST only explain errors that ACTUALLY appear in the terminal output below. Do NOT invent or suggest errors.

TERMINAL OUTPUT:
---
${terminalOutput}
---

INSTRUCTIONS:
1. Search the terminal output VERY CAREFULLY for lines that contain BOTH a word ending in "Error" or "Exception" AND a colon (:)
2. Examples of what you're looking for: "TypeError:", "ValueError:", "NameError:", "SyntaxError:"
3. For EACH unique error type you find IN THE OUTPUT, write ONE bullet point
4. Each bullet should: **ErrorType**: One sentence generic explanation
5. If you find NO errors in the output, say: "No errors found in terminal output"
6. DO NOT list errors that don't appear in the output
7. DO NOT make suggestions or list potential errors

WHAT TO DO:
- Read the output line by line
- Find lines with "Error:" or "Exception:"
- Extract the error type (the word before the colon)
- Explain only that error type
- Output ONLY the errors that are actually present

START YOUR RESPONSE WITH THE ERROR TYPES YOU FOUND:`;

        return this.provider.ask(prompt);
    }

    async echoTerminalOutput(terminalOutput: string): Promise<string> {
        if (!terminalOutput || terminalOutput.trim().length === 0) {
            return "[no terminal output captured]";
        }

        const prompt = `Return the following terminal output exactly as-is. Do not summarize, analyze, correct, or explain it. Do not add any intro or extra text. Return only the exact content.

${terminalOutput}`;

        return this.provider.ask(prompt);
    }

    /**
     * Explain selected code snippet (for the explainSelection command).
     */
    async explainSelectedCode(code: string): Promise<string> {
        const prompt = `Explain what this code does in 1-2 sentences. Be concise.

CODE:
${code}`;

        return this.provider.ask(prompt);
    }

    /**
     * Logic for the 'Reflection' feature after a user solves a bug.
     */
    async reflectSolved(): Promise<string> {
        const prompt = buildReflectionPrompt();
        return this.provider.ask(prompt);
    }

    /**
     * Handles custom button requests (Hints, Term definitions, etc.)
     */
    async askCustom(instruction: string, code: string): Promise<string> {
        const systemPrompt = `
You are WhyBug, a debugging tutor.
Respond ONLY with bullet points.
Keep responses brief and clear.
No code examples or solutions.
`;
        const prompt = `${systemPrompt}\n\nCODE:\n${code}\n\nTASK: ${instruction}`;
        return this.provider.ask(prompt);
    }
}