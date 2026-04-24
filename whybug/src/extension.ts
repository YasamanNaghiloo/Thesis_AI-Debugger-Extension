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

    // Auto-Diagnostics Listener
    const diagnosticListener = vscode.languages.onDidChangeDiagnostics(
        async (event) => {
            for (const uri of event.uris) {
                const diagnostics = vscode.languages.getDiagnostics(uri);

                // Only focus on Errors (Severity 0)
                const errors = diagnostics.filter(
                    (d) => d.severity === vscode.DiagnosticSeverity.Error
                );

                if (errors.length === 0) continue;

                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.uri.toString() !== uri.toString()) continue;

                const code = editor.document.getText();
                // We take the first error found to explain
                const firstError = errors[0].message;

                try {
                    // Track how many times this specific error has occurred
                    const count = await tracker.incrementError(firstError);
                    
                    // Get explanation (Service logic handles ELI5 if count >= 5)
                    const response = await assistant.explainError(firstError, code, count);
                    
                    sidebar.update(response);
                } catch (err) {
                    console.error(err);
                    sidebar.update("⚠️ AI error. Ensure Ollama is running ('ollama run gemma3')");
                }
            }
        }
    );

    context.subscriptions.push(diagnosticListener);

    vscode.window.showInformationMessage("WhyBug AI Debugger running 🚀");
}

export function deactivate() {}