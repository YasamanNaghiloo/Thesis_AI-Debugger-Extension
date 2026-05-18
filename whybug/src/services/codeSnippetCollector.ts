import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface CodeSnippetContext {
    snippet: string;
    file?: string;
    line?: number;
    source: "tracebackFile" | "filesystem" | "workspace" | "none";
}

function parseTracebackLocation(terminalOutput: string): { file?: string; line?: number } {
    if (!terminalOutput) return {};

    const regex = /File "([^"]+)", line (\d+)/g;
    let match: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;

    while ((match = regex.exec(terminalOutput)) !== null) {
        last = match;
    }

    if (!last) return {};

    const line = parseInt(last[2], 10);
    if (!Number.isFinite(line)) return {};

    return { file: last[1], line };
}

function sliceSnippet(lines: string[], centerLine: number, radius: number): string {
    const zeroBasedCenter = Math.max(0, centerLine - 1);
    const start = Math.max(0, zeroBasedCenter - radius);
    const end = Math.min(lines.length - 1, zeroBasedCenter + radius);
    const snippetLines: string[] = [];

    for (let index = start; index <= end; index++) {
        snippetLines.push(`${index + 1}: ${lines[index]}`);
    }

    return snippetLines.join("\n");
}

export async function collectTracebackCodeSnippet(
    terminalOutput: string,
    contextRadius = 24
): Promise<CodeSnippetContext> {
    const location = parseTracebackLocation(terminalOutput);

    if (location.file) {
        const candidates = [location.file, path.resolve(location.file)];

        for (const candidate of candidates) {
            try {
                const document = await vscode.workspace.openTextDocument(candidate);
                const fileLines = document.getText().split(/\r?\n/);
                return {
                    snippet: sliceSnippet(fileLines, location.line || 1, contextRadius),
                    file: candidate,
                    line: location.line,
                    source: "tracebackFile"
                };
            } catch {
                try {
                    if (fs.existsSync(candidate)) {
                        const raw = fs.readFileSync(candidate, "utf8");
                        const fileLines = raw.split(/\r?\n/);
                        return {
                            snippet: sliceSnippet(fileLines, location.line || 1, contextRadius),
                            file: candidate,
                            line: location.line,
                            source: "filesystem"
                        };
                    }
                } catch {
                    // Continue to the next candidate.
                }
            }
        }
    }

    return { snippet: "", source: "none" };
}
