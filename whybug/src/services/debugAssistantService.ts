import * as vscode from "vscode";
import { OllamaProvider } from "../providers/OllamaProvider";
import { 
    buildExplainErrorPrompt, 
    buildHintPrompt,
    buildLevel3Prompt,
    buildTermsPrompt,
    buildReflectionPrompt 
} from "../prompts/promptBuilders";
import { getHybridErrorScore } from "./errorAdaptation";
import { whybugInfo, whybugWarn } from "./logger";

export interface ErrorAnalytics {
    errorType: string;
    recentCount: number;
    totalScore: number;
    currentLevel: number;
    displayLevel?: number;
    lastSeenMs: number;
    timestamps: number[];
}

interface ErrorState {
    timestamps: number[];
    currentLevel: number;
    lastSeenMs: number;
}

export class DebugAssistantService {
    private provider = new OllamaProvider();
    private context?: vscode.ExtensionContext;

    // Small in-memory cache for hints: key -> response
    private hintCache: Map<string, string> = new Map();
    private readonly HINT_CACHE_MAX = 200;

    // Store most recent error entries (persisted for 60 seconds after extraction)
    private recentErrorEntries: Array<{ errorType: string; message: string }> = [];
    private recentErrorEntriesTimestamp: number = 0;
    private readonly RECENT_ENTRIES_WINDOW_MS = 60000; // 60 seconds
    private recentHintEscalationUsed: boolean = false;

    // Store most recent terminal output so Hint can still use traceback after terminal buffer is cleared.
    private recentTerminalOutput: string = "";
    private recentTerminalOutputTimestamp: number = 0;
    private readonly RECENT_TERMINAL_WINDOW_MS = 60000; // 60 seconds

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
    public updateErrorState(errorType: string, nowMs: number = Date.now()): void {
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

    private mapCountToDisplayLevel(count: number): number {
        if (count <= 10) return 1;
        if (count <= 20) return 2;
        return 3;
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

            const recentCount = state.timestamps.filter(ts => Date.now() - ts <= this.WINDOW_MS).length;
            results.push({
                errorType,
                recentCount,
                totalScore: breakdown,
                currentLevel: state.currentLevel,
                displayLevel: this.mapCountToDisplayLevel(recentCount),
                lastSeenMs: state.lastSeenMs,
                timestamps: state.timestamps
            });
        }

        // Sort by most recent first
        return results.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
    }

    /**
     * Update error state for multiple error entries extracted from terminal output.
     * Call this before computing display levels to ensure state is fresh.
     */
    public updateErrorStateForEntries(entries: Array<{ errorType: string; message: string }>): void {
        const nowMs = Date.now();
        for (const entry of entries) {
            this.updateErrorState(entry.errorType, nowMs);
        }
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

        try {
            if (typeof (this.provider as any).askWithTimeout === 'function') {
                return await (this.provider as any).askWithTimeout(prompt, 20000);
            }
            return await this.provider.ask(prompt);
        } catch (err: any) {
            console.warn("explainErrorTypes: provider failed, falling back to deterministic explanations:", err?.message ?? err);
            return errorTypes
                .map(e => {
                    const canonical = this.errorTypeAliases[e] || e;
                    const info = this.errorTypeDefinitions[canonical];
                    if (info) return `• **${e}**: ${info.definition}`;
                    return `• **${e}**: A runtime error of this type.`;
                })
                .join("\n");
        }
    }

    /**
     * Explain errors directly from terminal output using the model prompt.
     */
    public async explainTerminalOutputWithPrompt(terminalOutput: string, entries?: Array<{ errorType: string; message: string }>, timeoutMs = 20000): Promise<string> {
        if (!terminalOutput || terminalOutput.trim().length === 0) {
            return "No terminal output captured. Unable to identify errors.";
        }

        const focusedTerminalOutput = this.getFocusedTerminalOutput(terminalOutput);

        // If caller didn't pass parsed entries, try to extract them (caller normally already did this).
        const parsedEntries = entries && entries.length > 0 ? entries : this.extractErrorEntriesFromTerminalOutput(focusedTerminalOutput || terminalOutput);

        const prompt = buildExplainErrorPrompt(focusedTerminalOutput || terminalOutput);

        try {
            const modelResp = await this.askModel(prompt, timeoutMs);

            // Annotate the model response with display level per error detected.
            const analytics = this.getErrorAnalytics();
            const byType = new Map<string, number>();
            for (const a of analytics) byType.set(a.errorType, a.displayLevel ?? a.currentLevel ?? 0);

            // Build a small header showing level per error type.
            const levelLines = parsedEntries.map(e => {
                const lvl = byType.get(e.errorType) ?? 1;
                return `Level ${lvl} — ${e.errorType}`;
            });

            return [`${levelLines.join('\n')}`, '', modelResp].join('\n');
        } catch (err: any) {
            console.warn("explainTerminalOutputWithPrompt failed, falling back to deterministic:", err?.message ?? err);
            return this.explainErrorEntriesDeterministic(parsedEntries);
        }
    }

    /**
     * Deterministic, fast hints produced locally when the model is unavailable or times out.
     */
    public deterministicHintsFromEntries(entries: Array<{ errorType: string; message: string }>): string {
        if (!entries || entries.length === 0) return "• No recognizable errors found to hint about.";

        return entries.map(({ errorType, message }) => {
            const canonical = this.errorTypeAliases[errorType] || errorType;
            switch (canonical) {
                case 'NameError':
                    return `• **${errorType}**: Likely an undefined name — check that the variable or function is defined before use and that names are spelled correctly.`;
                case 'TypeError':
                    return `• **${errorType}**: Likely a mismatch of types — check the types of operands or function arguments and where values come from.`;
                case 'IndexError':
                    return `• **${errorType}**: Likely out-of-range indexing — check list/array lengths and any loops that compute indices.`;
                case 'KeyError':
                    return `• **${errorType}**: Missing dictionary key — verify keys exist or use .get() with a default.`;
                case 'FileNotFoundError':
                    return `• **${errorType}**: File not found — verify the path, working directory, and that the file exists.`;
                case 'SyntaxError':
                    return `• **${errorType}**: Syntax issue — look at the line mentioned in the traceback for missing punctuation or indentation.`;
                case 'ZeroDivisionError':
                    return `• **${errorType}**: Division by zero — check denominators and guard against zero.`;
                default:
                    if (message && message.length > 0) {
                        return `• **${errorType}**: ${message.split('\n')[0]} — check the traceback line referenced and variable values.`;
                    }
                    return `• **${errorType}**: Inspect the traceback and nearby code; check variable values and types.`;
            }
        }).join('\n');
    }

    /**
     * Deterministic hints that incorporate a focused code snippet and an optional line number.
     * The snippet format expected is lines prefixed with "<line>: <code>" (as produced by getCodeContextFromTerminalOutput),
     * but plain snippets are also accepted.
     */
    public deterministicHintsFromEntriesWithContext(entries: Array<{ errorType: string; message: string }>, snippet?: string, line?: number): string {
        if (!entries || entries.length === 0) return "• No recognizable errors found to hint about.";

        // Build parsed lines array from snippet
        let parsed: Array<{ num?: number; text: string }> = [];
        let defaultFocusedLineText: string | undefined;
        let defaultFocusedLineNumber: number | undefined;
        if (snippet && snippet.length > 0) {
            const lines = snippet.split(/\r?\n/);
            parsed = lines.map(l => {
                const m = l.match(/^\s*(\d+)\s*:\s*(.*)$/);
                if (m) return { num: parseInt(m[1], 10), text: m[2] };
                return { text: l };
            });

            if (typeof line === 'number' && Number.isFinite(line)) {
                const found = parsed.find(p => p.num === line && p.text !== undefined);
                if (found) {
                    defaultFocusedLineText = found.text;
                    defaultFocusedLineNumber = line;
                }
            }

            if (!defaultFocusedLineText && parsed.length > 0) {
                const mid = Math.floor(parsed.length / 2);
                defaultFocusedLineText = parsed[mid].text;
                defaultFocusedLineNumber = parsed[mid].num;
            }
        }

        return entries.map(({ errorType, message }) => {
            const canonical = this.errorTypeAliases[errorType] || errorType;

            // Per-entry focused line: start with default, then prefer symbol match if available
            let focusedLineTextLocal = defaultFocusedLineText;
            let focusedLineNumberLocal = defaultFocusedLineNumber;
            if (parsed.length > 0 && message) {
                const symMatch = message.match(/'([A-Za-z_][A-Za-z0-9_]*)'/) || message.match(/\b([A-Za-z_][A-Za-z0-9_]*)\b/);
                const symbol = symMatch ? symMatch[1] : undefined;
                if (symbol) {
                    for (const p of parsed) {
                        if (p.text && new RegExp(`\\b${symbol}\\b`).test(p.text)) {
                            focusedLineTextLocal = p.text;
                            focusedLineNumberLocal = p.num;
                            break;
                        }
                    }
                }
            }

            const focused = focusedLineTextLocal ? `on the shown line ('${focusedLineTextLocal.trim()}')` : 'on the referenced line';

            // Detect common patterns that benefit from targeted Socratic hints
            let plusHint: string | undefined;
            try {
                const fl = (focusedLineTextLocal || '').trim();
                    // detect A + B pattern (simple variable or literal operands) 
                    const plusMatch = fl.match(/(?:^|[^\w])([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*([A-Za-z_][A-Za-z0-9_]*|\d+|'.*?'|".*?")/);
                if (plusMatch) {
                    const left = plusMatch[1];
                    const right = plusMatch[2];
                    const inferNameType = (name: string) => {
                        const n = name.toLowerCase();
                        if (/^['\"]/.test(n) || /['\"]$/.test(n)) return 'str';
                        if (/^(\d+(?:\.\d+)?)$/.test(n)) return n.includes('.') ? 'float' : 'int';
                        if (/(price|total|sum|cost|amount|count|num|quantity|qty|id)$/.test(n)) return 'number';
                        if (/(name|msg|message|text|title|label)$/.test(n)) return 'str';
                        return undefined;
                    };

                    const leftType = inferNameType(left) || undefined;
                    const rightType = inferNameType(right) || undefined;

                    if ((leftType && rightType && leftType !== rightType) || (leftType === 'str' && rightType === 'int') || (leftType === 'int' && rightType === 'str')) {
                            plusHint = 'Observation: this line adds ' + left + ' + ' + right + ', and the names/samples suggest they may be different types (' + (leftType ?? 'unknown') + ' vs ' + (rightType ?? 'unknown') + ').\nQuestion: are you trying to concatenate text with a number?\nSuggestion: convert the number using `str()` or use an f-string (e.g. f"{name}{value}") or format to avoid a TypeError.';
                    } else if ((leftType && leftType === 'str' && rightType === undefined) || (rightType && rightType === 'str' && leftType === undefined)) {
                        plusHint = `Observation: one operand looks like text.\nQuestion: do you intend to perform string concatenation here? If so, ensure both operands are strings or explicitly convert the non-string (e.g., str(value) or f-strings).`;
                    }
                }
            } catch (e) {
                // non-fatal: leave plusHint undefined
            }

            // Produce observation-first, Socratic hints (no bullet glyphs)
            switch (canonical) {
                case 'NameError': {
                    const nameMatch = message && message.match(/name '([A-Za-z_][A-Za-z0-9_]*)'/);
                    const name = nameMatch ? nameMatch[1] : undefined;
                    if (name) {
                        // look for a definition/import before the focused line
                        let definedNearby = false;
                        for (const p of parsed) {
                            if (p.num && focusedLineNumberLocal && p.num < focusedLineNumberLocal) {
                                if (/^\s*def\s+/.test(p.text || '') || /^\s*class\s+/.test(p.text || '') || new RegExp(`^\s*${name}\s*=`).test(p.text || '') || new RegExp(`\b${name}\b`).test(p.text || '')) {
                                    definedNearby = true;
                                    break;
                                }
                            }
                        }
                        if (!definedNearby) {
                            return `${focused}: I can't find a definition or import for '${name}' nearby. Could you have forgotten to define or import it?\nQuestion: where should '${name}' be created in this file or imported from?`;
                        }
                    }
                    return `${focused}: this may be an undefined name or a typo.\nQuestion: did you mean a different name, or did you forget to define or import it?`;
                }
                case 'TypeError':
                    return `${focused}: a value here may be an unexpected type (for example, a string used where a number is required).\nQuestion: what types do the variables on this line hold at runtime? Try printing their types to check.`;
                case 'IndexError':
                    return `${focused}: an index may be outside the collection bounds.\nQuestion: what is the collection length and what is the computed index at runtime? Print both to verify.`;
                case 'KeyError':
                    return `${focused}: this dictionary access may use a missing key.\nQuestion: what keys does the dictionary contain right before this access? Print the keys or use .get() to probe.`;
                case 'FileNotFoundError':
                    return `${focused}: the file path may be incorrect relative to the working directory.\nQuestion: what path is the program actually trying to open? Print the resolved path to confirm.`;
                case 'SyntaxError': {
                    const text = (focusedLineTextLocal || '').replace(/\t/g, '    ');
                    const singleQuotes = (text.match(/'/g) || []).length;
                    const doubleQuotes = (text.match(/"/g) || []).length;
                    const openParens = (text.match(/\(/g) || []).length;
                    const closeParens = (text.match(/\)/g) || []).length;
                    if (singleQuotes % 2 === 1) {
                        return `${focused}: this line appears to have an unmatched single quote (').\nObservation: an unclosed string literal will break parsing. Question: did you forget a closing quote here?`;
                    }
                    if (doubleQuotes % 2 === 1) {
                        return `${focused}: this line appears to have an unmatched double quote (").\nObservation: an unclosed string literal will break parsing. Question: did you forget a closing quote here?`;
                    }
                    if (openParens !== closeParens) {
                        return `${focused}: parentheses do not match on this line.\nQuestion: is there a missing ')' or an extra '(' in this expression?`;
                    }
                    return `${focused}: check for missing punctuation (quote, parenthesis) or incorrect indentation.\nQuestion: can you simplify or comment out parts of this line to isolate which token causes the parser to fail?`;
                }
                case 'ZeroDivisionError':
                    return `${focused}: the denominator here may be zero at runtime.\nQuestion: where does the denominator come from, and can you add a guard to avoid dividing by zero?`;
                default:
                    if (message && message.length > 0) {
                        const firstMsg = message.split('\n')[0];
                        return `${focused}: ${firstMsg}.\nQuestion: what runtime values near this line could cause that condition? Add temporary prints to inspect them.`;
                    }
                    return `${focused}: inspect the referenced line and nearby code.\nQuestion: can you add logging near this line to observe the values that might be causing the error?`;
            }
        }).join('\n');
    }

    // Wrapper that attempts a timeout-capable model call when available
    private async askModel(prompt: string, timeoutMs = 20000): Promise<string> {
        whybugInfo('askModel called. prompt length:', prompt?.length ?? 0, 'timeoutMs:', timeoutMs);
        const preview = typeof prompt === 'string' && prompt.length > 1500 ? prompt.slice(0, 1500) + '\n...<truncated>...' : prompt;
        whybugInfo('Prompt preview:\n', preview);

        try {
            if (typeof (this.provider as any).askWithTimeout === 'function') {
                const res = await (this.provider as any).askWithTimeout(prompt, timeoutMs);
                const rpreview = typeof res === 'string' && res.length > 1500 ? res.slice(0, 1500) + '\n...<truncated>...' : res;
                whybugInfo('Model response length:', res?.length ?? 0);
                whybugInfo('Model response preview:\n', rpreview);
                return res;
            }

            // Fallback: race the ask() against a timeout
            const res = await Promise.race([
                this.provider.ask(prompt),
                new Promise<string>((_, rej) => setTimeout(() => rej(new Error('Model request timed out')), timeoutMs))
            ]) as string;

            whybugInfo('Fallback model response length:', res?.length ?? 0);
            return res;
        } catch (err: any) {
            whybugWarn('askModel error:', err?.message ?? err);
            throw err;
        }
    }

    // Deterministic term extraction from code using known keywords
    public deterministicTermsFromCode(code: string): string {
        if (!code || code.trim().length === 0) return "No code provided to extract terms.";

        const pythonKeywords = new Set([
            'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
            'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None',
            'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield'
        ]);
        const builtins = new Set([
            'print', 'len', 'range', 'list', 'dict', 'set', 'tuple', 'int', 'float', 'str', 'bool', 'open', 'sum',
            'min', 'max', 'sorted', 'input', 'type', 'isinstance', 'enumerate', 'zip', 'map', 'filter', 'any', 'all',
            'self', 'cls'
        ]);

        type TermEntry = { term: string; kind: 'function' | 'class' | 'import' | 'variable'; sample?: string; inferredType?: string };
        const terms = new Map<string, TermEntry>();

        const inferTypeFromSample = (sample: string | undefined): string | undefined => {
            if (!sample) return undefined;
            const s = sample.trim();
            if (/^['"].*['"]$/.test(s)) return 'str';
            if (/^[0-9]+$/.test(s)) return 'int';
            if (/^[0-9]*\.[0-9]+$/.test(s)) return 'float';
            if (/^\[.*\]$/.test(s)) return 'list';
            if (/^\{.*\}$/.test(s)) return 'dict';
            if (/^(True|False)$/.test(s)) return 'bool';
            if (/^[A-Za-z_][A-Za-z0-9_]*\(.*\)$/.test(s)) return 'call/result';
            return undefined;
        };

        const addTerm = (term: string, kind: TermEntry['kind'], sample?: string) => {
            const normalized = term.trim();
            if (!normalized) return;
            if (pythonKeywords.has(normalized) || builtins.has(normalized)) return;
            if (/^[0-9]+$/.test(normalized)) return;
            if (!/[A-Za-z_]/.test(normalized)) return;
            if (terms.has(normalized)) return;
            const inferred = inferTypeFromSample(sample);
            terms.set(normalized, { term: normalized, kind, sample, inferredType: inferred });
        };

        // Definitions and imports are the most useful code-specific terms.
        for (const line of code.split(/\r?\n/)) {
            const defMatch = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
            if (defMatch) addTerm(defMatch[1], 'function');

            const classMatch = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
            if (classMatch) addTerm(classMatch[1], 'class');

            const importFromMatch = line.match(/^\s*from\s+([A-Za-z_][A-Za-z0-9_\.]*)(?:\s+import\s+(.+))?/);
            if (importFromMatch) {
                addTerm(importFromMatch[1].split('.')[0], 'import');
                const importedNames = importFromMatch[2]?.split(',').map(part => part.trim().split(/\s+as\s+/)[0]);
                importedNames?.forEach(name => addTerm(name, 'import'));
            }

            const importMatch = line.match(/^\s*import\s+(.+)/);
            if (importMatch) {
                for (const part of importMatch[1].split(',')) {
                    addTerm(part.trim().split(/\s+as\s+/)[0].split('.')[0], 'import');
                }
            }

            const assignMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
            if (assignMatch) addTerm(assignMatch[1], 'variable', assignMatch[2]);
        }

        // If we still didn't find code-specific items, fall back to meaningful identifiers only.
        if (terms.size === 0) {
            const identifiers = code.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [];
            for (const ident of identifiers) {
                if (!pythonKeywords.has(ident) && !builtins.has(ident)) {
                    addTerm(ident, 'variable');
                }
            }
        }

        if (terms.size === 0) return "No code-specific terms found in the current file.";

        const explain = (entry: TermEntry): string => {
            const normalized = entry.term.toLowerCase();
            const inferred = entry.inferredType;
            const sample = entry.sample ? entry.sample.trim() : undefined;

            const typePhrase = inferred ? ` (${inferred})` : '';

            switch (entry.kind) {
                case 'function': return `A function defined in this file that groups repeated steps into one reusable action.`;
                case 'class': return `A class defined in this file; it is a blueprint for creating related objects.`;
                case 'import': return `A module or symbol brought in from another file so this code can use it.`;
                case 'variable': {
                    // More technical descriptions with types and examples when available
                    if (normalized.includes('price')) return `A numeric value${typePhrase} typically used for monetary calculations${sample ? ` (example: ${sample.trim()})` : ''}.`;
                    if (normalized.includes('total') || normalized.includes('sum')) return `A numeric accumulator${typePhrase} that stores a running total (example: ${sample ?? 'e.g. 42'}).`;
                    if (normalized.includes('count') || normalized.includes('num') || normalized.includes('number')) return `An integer counter${typePhrase} used to track quantity or iterations${sample ? ` (example: ${sample})` : ''}.`;
                    if (normalized.includes('name')) return `A text/string variable${typePhrase} that stores a name or label${sample ? ` (example: ${sample})` : ''}.`;
                    if (normalized.includes('msg') || normalized.includes('message')) return `A text/string variable${typePhrase} typically holding a user-facing message${sample ? ` (example: ${sample})` : ''}.`;
                    if (normalized.includes('item')) return `A variable representing an item record or element${typePhrase}${sample ? ` (example: ${sample})` : ''}.`;
                    if (normalized.includes('customer')) return `A variable representing customer data${typePhrase}${sample ? ` (example: ${sample})` : ''}.`;
                    if (normalized.includes('final')) return `A variable holding a final result or output${typePhrase}${sample ? ` (example: ${sample})` : ''}.`;
                    // Generic fallback with inferred type if any
                    if (inferred) return `A ${inferred} variable used in this code${sample ? ` (example: ${sample})` : ''}.`;
                    return `A variable used to store a value for later use in the program${sample ? ` (example: ${sample})` : ''}.`;
                }
            }
        };

        return Array.from(terms.values()).map(entry => `**${entry.term}**: ${explain(entry)}`).join('\n\n');
    }

    private makeHintCacheKey(errorType: string, codeSnippet: string): string {
        const snippet = (codeSnippet || '').slice(-300).replace(/\s+/g, ' ');
        return `${errorType}::${snippet}`;
    }

    public getHintFromCache(key: string): string | undefined {
        return this.hintCache.get(key);
    }

    public putHintInCache(key: string, val: string) {
        this.hintCache.set(key, val);
        // simple eviction
        if (this.hintCache.size > this.HINT_CACHE_MAX) {
            const first = this.hintCache.keys().next().value;
            if (first) this.hintCache.delete(first);
        }
    }

    // Store recent error entries (persisted for 60s) so Hint button can access them after buffer clear
    public setRecentErrorEntries(entries: Array<{ errorType: string; message: string }>) {
        this.recentErrorEntries = entries;
        this.recentErrorEntriesTimestamp = Date.now();
        this.recentHintEscalationUsed = false;
    }

    // Get recent error entries if still within the 60s window
    public getRecentErrorEntries(): Array<{ errorType: string; message: string }> {
        const now = Date.now();
        if (now - this.recentErrorEntriesTimestamp > this.RECENT_ENTRIES_WINDOW_MS) {
            return [];
        }
        return this.recentErrorEntries;
    }

    /**
     * Return true if the one-shot extra-help escalation was already used for the current error batch.
     */
    public hasConsumedRecentHintEscalation(): boolean {
        return this.recentHintEscalationUsed;
    }

    /**
     * Mark the one-shot extra-help escalation as consumed for the current error batch.
     */
    public consumeRecentHintEscalation(): void {
        this.recentHintEscalationUsed = true;
    }

    // Store recent terminal output (persisted for 60s) for hint requests after run completion.
    public setRecentTerminalOutput(output: string): void {
        this.recentTerminalOutput = output || "";
        this.recentTerminalOutputTimestamp = Date.now();
    }

    // Return recent terminal output if it is still fresh.
    public getRecentTerminalOutput(): string {
        const now = Date.now();
        if (now - this.recentTerminalOutputTimestamp > this.RECENT_TERMINAL_WINDOW_MS) {
            return "";
        }
        return this.recentTerminalOutput;
    }

    private getFocusedTerminalOutput(terminalOutput: string): string {
        if (!terminalOutput || terminalOutput.trim().length === 0) {
            return "";
        }

        const tracebackMarker = "Traceback (most recent call last):";
        const tracebackIndex = terminalOutput.lastIndexOf(tracebackMarker);
        if (tracebackIndex >= 0) {
            return terminalOutput.slice(tracebackIndex).trim();
        }

        const lines = terminalOutput.split(/\r?\n/).map(line => line.trimEnd());
        return lines.slice(-80).join("\n").trim();
    }

    /**
     * Model-driven hint that uses terminal output + code context.
     * Reads the traceback, finds the error location in code, and asks guiding questions.
     */
    public async hintWithModel(terminalOutput: string, activeEditor?: vscode.TextEditor, timeoutMs = 25000, targetLevel?: number): Promise<string> {
        try {
            whybugInfo('hintWithModel started. terminalOutput length:', terminalOutput?.length ?? 0, 'activeEditor present:', !!activeEditor, 'targetLevel:', targetLevel);
            const effectiveLevel = targetLevel ?? 2;
            const focusedTerminalOutput = this.getFocusedTerminalOutput(terminalOutput);

            if (effectiveLevel >= 3) {
                const { snippet, line } = await this.getCodeContextFromTerminalOutput(focusedTerminalOutput || terminalOutput, activeEditor, 4);
                const safeSnippet = snippet && snippet.length > 0 ? snippet : 'No code snippet available.';
                whybugInfo('hintWithModel using Level 3 prompt with code context. snippet length:', safeSnippet.length, 'line:', line);
                return await this.askModel(buildLevel3Prompt(focusedTerminalOutput || terminalOutput, safeSnippet, line), timeoutMs);
            }

            const { snippet, line } = await this.getCodeContextFromTerminalOutput(focusedTerminalOutput || terminalOutput, activeEditor, 4);
            whybugInfo('hintWithModel code context. snippet length:', snippet?.length ?? 0, 'line:', line);

            const safeSnippet = snippet && snippet.length > 0 ? snippet : 'No code snippet available.';
            const prompt = buildHintPrompt(focusedTerminalOutput || terminalOutput, safeSnippet, line);
            whybugInfo('hintWithModel prompt ready. length:', prompt.length);

            return await this.askModel(prompt, timeoutMs);
        } catch (err: any) {
            console.warn('hintWithModel failed, falling back to deterministic:', err?.message ?? err);
            const effectiveLevel = targetLevel ?? 2;
            if (effectiveLevel >= 3) {
                return [
                    "Ingredients:",
                    "- 1/2 cup butter",
                    "- 1 cup sugar",
                    "- 2 eggs",
                    "- 1 tsp vanilla",
                    "- 1/3 cup cocoa powder",
                    "- 1/2 cup flour",
                    "- 1/4 tsp salt",
                    "",
                    "Steps:",
                    "1. Preheat oven to 350°F (175°C).",
                    "2. Melt the butter, then mix in sugar, eggs, and vanilla.",
                    "3. Stir in cocoa powder, flour, and salt.",
                    "4. Pour into a greased pan and bake for 20-25 minutes."
                ].join('\n');
            }
            const entries = this.getRecentErrorEntries();
            if (entries.length > 0) {
                return this.deterministicHintsFromEntriesWithContext(entries);
            }
            return 'Unable to generate hint. Try running the code again.';
        }
    }

    /**
     * Given parsed entries (errorType/message), compute the display level per our mapping.
     * Returns maximum display level among entries (1..3) or 1 if no entries.
     */
    public getDisplayLevelForEntries(entries: Array<{ errorType: string; message: string }>): number {
        if (!entries || entries.length === 0) return 1;
        let maxLevel = 1;
        for (const e of entries) {
            const lvl = this.getDisplayLevelForErrorType(e.errorType);
            if (lvl > maxLevel) maxLevel = lvl;
        }
        whybugInfo(`getDisplayLevelForEntries: ${entries.length} entries, computed maxLevel=${maxLevel}`);
        return maxLevel;
    }

    /**
     * Return the current display level for a specific error type.
     */
    public getDisplayLevelForErrorType(errorType: string): number {
        const canonical = this.getCanonicalErrorType(errorType);
        const state = this.errorState.get(canonical);
        const recentCount = state ? state.timestamps.filter(ts => Date.now() - ts <= this.WINDOW_MS).length : 0;
        whybugInfo(`getDisplayLevelForErrorType(${errorType}): canonical=${canonical}, count=${recentCount}, level=${this.mapCountToDisplayLevel(recentCount)}`);
        return this.mapCountToDisplayLevel(recentCount);
    }

    /**
     * Format the detected errors with their current display levels for the run output.
     */
    public formatDisplayLevelHeaders(entries: Array<{ errorType: string; message: string }>): string {
        if (!entries || entries.length === 0) return "";
        return entries.map(entry => `Level ${this.getDisplayLevelForErrorType(entry.errorType)} — ${entry.errorType}`).join("\n");
    }

    /**
     * Extract the last traceback file and line from terminal output.
     * Returns { file, line } or empty object if not found.
     */
    public extractTracebackLocation(terminalOutput: string): { file?: string; line?: number } {
        if (!terminalOutput) return {};
        // Match lines like: File "/path/to/file.py", line 42, in <module>
        const regex = /File "([^"]+)", line (\d+)/g;
        let match: RegExpExecArray | null;
        let last: RegExpExecArray | null = null;
        while ((match = regex.exec(terminalOutput)) !== null) {
            last = match;
        }

        if (!last) return {};
        const file = last[1];
        const line = parseInt(last[2], 10);
        if (!Number.isFinite(line)) return {};
        return { file, line };
    }

    /**
     * Given terminal output and an optional active editor, return a small code snippet
     * around the traceback location. Attempts to open the file path if present, otherwise
     * falls back to the active editor document.
     */
    public async getCodeContextFromTerminalOutput(terminalOutput: string, activeEditor?: vscode.TextEditor, contextRadius = 4): Promise<{ snippet: string; file?: string; line?: number }> {
        const loc = this.extractTracebackLocation(terminalOutput);
        let snippet = "";
        if (loc.file) {
            try {
                const doc = await vscode.workspace.openTextDocument(loc.file);
                const total = doc.lineCount;
                const start = Math.max(0, (loc.line || 1) - 1 - contextRadius);
                const end = Math.min(total - 1, (loc.line || 1) - 1 + contextRadius);
                const lines: string[] = [];
                for (let i = start; i <= end; i++) {
                    lines.push(`${i + 1}: ${doc.lineAt(i).text}`);
                }
                snippet = lines.join("\n");
                return { snippet, file: loc.file, line: loc.line };
            } catch (err) {
                // failed to open file; fall through to active editor
                console.warn("getCodeContextFromTerminalOutput: failed to open file", loc.file, err);
            }
        }

        if (activeEditor) {
            try {
                const doc = activeEditor.document;
                const total = doc.lineCount;
                // If traceback gave a line number, use it; otherwise use current cursor line
                const center = loc.line && loc.line > 0 ? loc.line - 1 : activeEditor.selection.active.line;
                const start = Math.max(0, center - contextRadius);
                const end = Math.min(total - 1, center + contextRadius);
                const lines: string[] = [];
                for (let i = start; i <= end; i++) {
                    lines.push(`${i + 1}: ${doc.lineAt(i).text}`);
                }
                snippet = lines.join("\n");
                return { snippet, file: doc.uri.fsPath, line: loc.line };
            } catch (err) {
                console.warn("getCodeContextFromTerminalOutput: failed to read active editor", err);
            }
        }

        return { snippet: "" };
    }

    /**
     * Explain important terms from the current file using the model prompt.
     */
    public async termsWithModel(code: string, timeoutMs = 20000): Promise<string> {
        if (!code || code.trim().length === 0) {
            return "No code provided to extract terms.";
        }

        const prompt = buildTermsPrompt(code);
        whybugInfo('termsWithModel prompt ready. code length:', code.length, 'prompt length:', prompt.length);

        try {
            return await this.askModel(prompt, timeoutMs);
        } catch (err: any) {
            console.warn('termsWithModel failed, falling back to deterministic:', err?.message ?? err);
            return this.deterministicTermsFromCode(code);
        }
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
        return this.explainTerminalOutputWithPrompt(terminalOutput);
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