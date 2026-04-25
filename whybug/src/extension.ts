import * as vscode from "vscode";
import { registerExplainError } from "./commands/explainError";
import { registerExplainSelection } from "./commands/explainSelection";
import { registerReflectSolved } from "./commands/reflectSolved";
import { SidebarProvider } from "./ui/sidebarProvider";
import { ErrorTracker } from "./services/errorTracker";
import { DebugAssistantService } from "./services/debugAssistantService";

export function activate(context: vscode.ExtensionContext) {
    console.log("🔥 WhyBug ACTIVATED");

    // Initialize Services
    const sidebar = new SidebarProvider(context);
    const tracker = new ErrorTracker(context);
    const assistant = new DebugAssistantService();

    // Register Sidebar
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SidebarProvider.viewType,
            sidebar
        )
    );

    // Register Commands
    context.subscriptions.push(registerExplainError(context, sidebar));
    context.subscriptions.push(registerExplainSelection(sidebar));
    context.subscriptions.push(registerReflectSolved(sidebar));

    // ============================================================
    // 1. AUTO-DIAGNOSTICS (STATIC ERRORS - "Red Squiggles")
    // ============================================================
    let diagnosticTimeout: NodeJS.Timeout | undefined;

    const diagnosticListener = vscode.languages.onDidChangeDiagnostics(
        async (event: vscode.DiagnosticChangeEvent) => {
            if (diagnosticTimeout) {
                clearTimeout(diagnosticTimeout);
            }

            diagnosticTimeout = setTimeout(async () => {
                for (const uri of event.uris) {
                    const diagnostics = vscode.languages.getDiagnostics(uri);
                    const errors = diagnostics.filter(
                        (d) => d.severity === vscode.DiagnosticSeverity.Error
                    );

                    if (errors.length === 0) continue;

                    const editor = vscode.window.activeTextEditor;
                    if (!editor || editor.document.uri.toString() !== uri.toString()) continue;

                    const code = editor.document.getText();
                    const firstError = errors[0].message;

                    try {
                        const count = await tracker.incrementError(firstError);
                        sidebar.update("🔍 Analyzing code diagnostics...");
                        const response = await assistant.explainError(firstError, code, count);
                        sidebar.streamResponse(response);
                    } catch (err) {
                        sidebar.update("⚠️ AI error. Is Ollama running?");
                    }
                }
            }, 1500); 
        }
    );

    // ============================================================
    // 2. DEBUGGER LISTENERS (RUNTIME CRASHES)
    // ============================================================
    
    const debugListener = vscode.debug.onDidTerminateDebugSession(() => {
        vscode.window.showInformationMessage("Debug session ended. Did WhyBug help you solve it?");
    });

    const exceptionListener = vscode.debug.onDidReceiveDebugSessionCustomEvent(async (event) => {
        if (event.event === 'stopped' && event.body.reason === 'exception') {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const code = editor.document.getText();
            const errorMessage = event.body.description || "An execution error occurred.";

            sidebar.update("🕵️ Debugger caught a crash! Let's look...");

            try {
                const count = await tracker.incrementError(errorMessage);
                const response = await assistant.explainError(errorMessage, code, count);
                sidebar.streamResponse(response);
            } catch (err) {
                sidebar.update("⚠️ AI error during live debug session.");
            }
        }
    });

    // ============================================================
    // 3. TERMINAL EXIT LISTENER (STABLE API)
    // ============================================================
    // This watches for when a command (like 'python app.py') ends with an error
    const terminalListener = (vscode.window as any).onDidEndTerminalShellExecution ? 
        (vscode.window as any).onDidEndTerminalShellExecution(async (event: any) => {
            if (event.exitCode !== 0) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;

                const code = editor.document.getText();
                const commandLine = event.execution.commandLine.value;

                sidebar.update(`📟 Terminal command failed: "${commandLine}"`);
                
                try {
                    const errorMsg = `Command "${commandLine}" failed with exit code ${event.exitCode}.`;
                    const count = await tracker.incrementError(errorMsg);
                    const response = await assistant.explainError(errorMsg, code, count);
                    sidebar.streamResponse(response);
                } catch (err) {
                    console.error("WhyBug Terminal Error:", err);
                }
            }
        }) : { dispose: () => {} };

    // Add all listeners to subscriptions
    context.subscriptions.push(
        diagnosticListener, 
        debugListener, 
        exceptionListener, 
        terminalListener
    );

    vscode.window.showInformationMessage("WhyBug AI Debugger running 🚀");
}

export function deactivate() {}