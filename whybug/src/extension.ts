import * as vscode from "vscode";
import { registerExplainError } from "./commands/explainError";
import { registerExplainSelection } from "./commands/explainSelection";
import { registerReflectSolved } from "./commands/reflectSolved";
import { SidebarProvider } from "./ui/sidebarProvider";
import { ErrorTracker } from "./services/errorTracker";
import { DebugAssistantService } from "./services/debugAssistantService";
import { TerminalOutputCapture } from "./services/terminalOutputCapture";

export function activate(context: vscode.ExtensionContext) {
    console.log("🔥 WhyBug ACTIVATED");

    const assistant = new DebugAssistantService(context);
    const sidebar = new SidebarProvider(context, assistant);
    const tracker = new ErrorTracker(context);
    const terminalCapture = new TerminalOutputCapture();
    terminalCapture.start();
    const executionOutput = new WeakMap<any, string>();

    const sanitizeOutput = (data: string): string => {
        return data
            .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "")
            .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, "")
            .replace(/\x1B[@-_][0-?]*[ -\/]*[@-~]/g, "");
    };

    console.log("✅ Services initialized");

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar)
    );

    context.subscriptions.push(registerExplainError(context, sidebar, assistant));
    context.subscriptions.push(registerExplainSelection(sidebar, assistant));
    context.subscriptions.push(registerReflectSolved(sidebar, assistant));

    let terminalStartListener: any = { dispose: () => {} };
    if ((vscode.window as any).onDidStartTerminalShellExecution) {
        terminalStartListener = (vscode.window as any).onDidStartTerminalShellExecution((event: any) => {
            executionOutput.set(event.execution, "");

            (async () => {
                try {
                    for await (const chunk of event.execution.read()) {
                        const current = executionOutput.get(event.execution) || "";
                        executionOutput.set(event.execution, current + sanitizeOutput(chunk));
                    }
                } catch (error) {
                    console.error("❌ Failed to read terminal execution output stream:", error);
                }
            })();
        });
    }

    // ============================================================
    // 1. DEBUGGER LISTENERS (STAYS SILENT UNTIL CRASH)
    // ============================================================
    const exceptionListener = vscode.debug.onDidReceiveDebugSessionCustomEvent(async (event) => {
        if (event.event === 'stopped' && event.body.reason === 'exception') {
            const errorMessage = event.body.description || "An execution error occurred.";
            sidebar.update("🕵️ Stop! The program crashed. Let's look at why...");

            try {
                const response = await assistant.explainError(errorMessage);
                sidebar.streamResponse(response);
            } catch (err) {
                sidebar.update("⚠️ AI error during live debug session.");
            }
        }
    });

    // ============================================================
    // 2. TERMINAL LISTENER (READS CONSOLE OUTPUT FOR ERRORS)
    // ============================================================
    let terminalListener: any;
    
    if ((vscode.window as any).onDidEndTerminalShellExecution) {
        console.log("✅ Terminal listener API available");
        terminalListener = (vscode.window as any).onDidEndTerminalShellExecution(async (event: any) => {
            console.log("🔥 Terminal execution ended. Exit code:", event.exitCode);
            console.log("🔥 Event details:", JSON.stringify(event, null, 2));
            
            if (event.exitCode !== 0) {
                sidebar.update(`📟 Program failed. Analyzing errors...`);
                
                const terminal = event.terminal || event.execution?.terminal || vscode.window.activeTerminal;
                await new Promise((resolve) => setTimeout(resolve, 75));
                const outputFromExecution = sanitizeOutput(executionOutput.get(event.execution) || "");
                const outputFromTerminal = terminal ? terminalCapture.getOutputForTerminal(terminal) : terminalCapture.getLastOutput();
                const terminalOutput = outputFromExecution || outputFromTerminal;
                
                console.log("=== TERMINAL OUTPUT CAPTURE START ===");
                console.log("Total output length:", terminalOutput.length);
                console.log("Output content:");
                console.log(terminalOutput);
                console.log("=== TERMINAL OUTPUT CAPTURE END ===");
                
                try {
                    const errorEntries = assistant.extractErrorEntriesFromTerminalOutput(terminalOutput);
                    console.log("🐛 Extracted runtime error entries:", errorEntries);
                    const response = assistant.explainErrorEntriesDeterministic(errorEntries);
                    sidebar.streamResponse(response);
                    if (terminal) {
                        terminalCapture.clearTerminal(terminal);
                    } else {
                        terminalCapture.clearBuffer();
                    }
                } catch (err) {
                    console.error("❌ WhyBug AI Error:", err);
                    sidebar.update("⚠️ AI error. Is Ollama running?");
                }
            }
        });
    } else {
        console.log("⚠️ Terminal listener API NOT available");
        terminalListener = { dispose: () => {} };
    }

    context.subscriptions.push(exceptionListener, terminalStartListener, terminalListener, terminalCapture);
}

export function deactivate() {}