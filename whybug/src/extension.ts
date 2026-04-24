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
    // AUTO-DIAGNOSTICS WITH DEBOUNCE
    // ============================================================
    let diagnosticTimeout: NodeJS.Timeout | undefined;

    const diagnosticListener = vscode.languages.onDidChangeDiagnostics(
        async (event) => {
            // Clear the previous timer if the user is still typing/triggering errors
            if (diagnosticTimeout) {
                clearTimeout(diagnosticTimeout);
            }

            // Wait 1500ms (1.5s) after the last change before calling the AI
            diagnosticTimeout = setTimeout(async () => {
                for (const uri of event.uris) {
                    const diagnostics = vscode.languages.getDiagnostics(uri);

                    // Filter for actual Errors only
                    const errors = diagnostics.filter(
                        (d) => d.severity === vscode.DiagnosticSeverity.Error
                    );

                    // If no errors, we don't need to do anything
                    if (errors.length === 0) continue;

                    const editor = vscode.window.activeTextEditor;
                    // Check if we are looking at the file that actually has the error
                    if (!editor || editor.document.uri.toString() !== uri.toString()) continue;

                    const code = editor.document.getText();
                    const firstError = errors[0].message;

                    try {
                        // 1. Track the error frequency
                        const count = await tracker.incrementError(firstError);
                        
                        // 2. Notify sidebar we are working
                        sidebar.update("🔍 Analyzing your code...");

                        // 3. Get AI explanation (automatically handles ELI5 if count >= 5)
                        const response = await assistant.explainError(firstError, code, count);
                        
                        // 4. Update the Sidebar UI
                        sidebar.update(response);
                    } catch (err) {
                        console.error("WhyBug Error:", err);
                        sidebar.update("⚠️ AI error. Is Ollama running with 'gemma3'?");
                    }
                }
            }, 1500); // 1.5 second delay
        }
    );

    context.subscriptions.push(diagnosticListener);

    vscode.window.showInformationMessage("WhyBug AI Debugger running 🚀");
}

export function deactivate() {}