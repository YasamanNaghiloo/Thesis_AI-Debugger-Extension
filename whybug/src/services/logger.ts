import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel("WhyBug");
    }
    return channel;
}

function formatPart(part: unknown): string {
    if (typeof part === "string") return part;
    if (part instanceof Error) return `${part.name}: ${part.message}`;
    try {
        return JSON.stringify(part);
    } catch {
        return String(part);
    }
}

function write(level: "INFO" | "WARN" | "ERROR", parts: unknown[]): void {
    const message = parts.map(formatPart).join(" ");
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    getChannel().appendLine(line);
}

export function whybugInfo(...parts: unknown[]): void {
    console.log("[WHYBUG]", ...parts);
    write("INFO", parts);
}

export function whybugWarn(...parts: unknown[]): void {
    console.warn("[WHYBUG]", ...parts);
    write("WARN", parts);
}

export function whybugError(...parts: unknown[]): void {
    console.error("[WHYBUG]", ...parts);
    write("ERROR", parts);
}
