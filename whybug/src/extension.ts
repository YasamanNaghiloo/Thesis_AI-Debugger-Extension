import * as vscode from "vscode";
import { registerExplainError } from "./commands/explainError";
import { registerExplainSelection } from "./commands/explainSelection";
import { registerReflectSolved } from "./commands/reflectSolved";
import { SidebarProvider } from "./ui/sidebarProvider";
import { ErrorTracker } from "./services/errorTracker";
import { DebugAssistantService } from "./services/debugAssistantService";

export function activate(context: vscode.ExtensionContext) {
    console.log("🔥 WhyBug ACTIVATED");

    const sidebar = new SidebarProvider(context);
    const tracker = new ErrorTracker(context);
    const assistant = new DebugAssistantService();

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar)
    );

    context.subscriptions.push(registerExplainError(context, sidebar));
    context.subscriptions.push(registerExplainSelection(sidebar));
    context.subscriptions.push(registerReflectSolved(sidebar));

    // ============================================================
    // 1. DEBUGGER LISTENERS (STAYS SILENT UNTIL CRASH)
    // ============================================================
    const exceptionListener = vscode.debug.onDidReceiveDebugSessionCustomEvent(async (event) => {
        if (event.event === 'stopped' && event.body.reason === 'exception') {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const code = editor.document.getText();
            const errorMessage = event.body.description || "An execution error occurred.";

            sidebar.update("🕵️ Stop! The program crashed. Let's look at why...");

            try {
                // We pass '1' to force a 'Hint' instead of triggering ELI5 automatically
                const response = await assistant.explainError(errorMessage, code, 1);
                sidebar.streamResponse(response);
            } catch (err) {
                sidebar.update("⚠️ AI error during live debug session.");
            }
        }
    });

    // ============================================================
    // 2. TERMINAL LISTENER (STAYS SILENT UNTIL RUN ERROR)
    // ============================================================
    const terminalListener = (vscode.window as any).onDidEndTerminalShellExecution ? 
        (vscode.window as any).onDidEndTerminalShellExecution(async (event: any) => {
            if (event.exitCode !== 0) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;

                const code = editor.document.getText();
                const commandLine = event.execution.commandLine.value;

                sidebar.update(`📟 Command failed. Analyzing the crash...`);
                
                try {
                    const errorMsg = `The program failed while running: ${commandLine}`;
                    // Force count to 1 here so it stays in "Hint" mode
                    const response = await assistant.explainError(errorMsg, code, 1);
                    sidebar.streamResponse(response);
                } catch (err) {
                    console.error("WhyBug Terminal Error:", err);
                }
            }
        }) : { dispose: () => {} };

    context.subscriptions.push(exceptionListener, terminalListener);
}

export function deactivate() {}