import * as vscode from "vscode";
import { DebugAssistantService } from "../services/debugAssistantService";

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "whybug.sidebar";

    private _view?: vscode.WebviewView;
    private _pendingMessage: string | null = null;
    private assistant = new DebugAssistantService();

    constructor(private readonly context: vscode.ExtensionContext) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHtml();

        // ============================================================
        // 1. LISTEN FOR MESSAGES FROM THE WEBVIEW (BUTTON CLICKS)
        // ============================================================
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.command === 'requestMoreHelp') {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    this.update("❌ Please open a code file first.");
                    return;
                }

                const code = editor.document.getText();
                let customPrompt = "";

                // Define prompt based on which button was clicked
                if (data.action === 'hint') {
                    customPrompt = "Based on this code, give me a tiny hint about the error. Do NOT show the fix. Help me find it myself.";
                } else if (data.action === 'term') {
                    customPrompt = "Look at the error message and code. Explain any technical terms (like 'null', 'index', 'undefined') in very simple language.";
                } else if (data.action === 'eli5') {
                    customPrompt = "Explain in 3 sentences what is going wrong here using a real-world analogy, like I am 5 years old. Do not provide the code solution.";
                }

                this.update("🤔 Thinking..."); 

                try {
                    // Call the assistant with the custom instruction
                    const response = await this.assistant.askCustom(customPrompt, code);
                    this.update(response);
                } catch (err) {
                    this.update("⚠️ AI error. Is Ollama running with 'gemma3'?");
                }
            }
        });

        if (this._pendingMessage) {
            this.postMessage(this._pendingMessage);
            this._pendingMessage = null;
        }
    }

    public update(text: string) {
        if (!this._view) {
            this._pendingMessage = text;
            vscode.commands.executeCommand('workbench.view.extension.whybug-container');
            return;
        }
        this._view.show(true);
        this.postMessage(text);
    }

    private postMessage(text: string) {
        this._view?.webview.postMessage({
            type: "update",
            text: text
        });
    }

    private getHtml() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 10px;
                        color: var(--vscode-foreground);
                    }
                    #content {
                        white-space: pre-wrap;
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        padding: 12px;
                        border-radius: 4px;
                        border: 1px solid var(--vscode-panel-border);
                        font-size: 13px;
                        line-height: 1.5;
                        min-height: 120px;
                    }
                    h3 { color: var(--vscode-button-background); margin-bottom: 10px; }
                    .button-group { 
                        display: flex; 
                        gap: 6px; 
                        margin-top: 15px; 
                        flex-wrap: wrap; 
                    }
                    button {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none; 
                        padding: 8px 12px; 
                        cursor: pointer; 
                        border-radius: 2px;
                        font-size: 12px;
                        flex: 1 1 auto;
                        transition: opacity 0.2s;
                    }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    .help-label {
                        display: block;
                        margin-top: 20px;
                        font-size: 11px;
                        text-transform: uppercase;
                        opacity: 0.7;
                        letter-spacing: 0.5px;
                    }
                </style>
            </head>
            <body>
                <h3>🧠 WhyBug AI</h3>
                <div id="content">Waiting for code errors...</div>

                <span class="help-label">Need more help?</span>
                <div class="button-group">
                    <button onclick="requestAction('hint')">💡 Hint</button>
                    <button onclick="requestAction('term')">📖 Terms</button>
                    <button onclick="requestAction('eli5')">🐥 ELI5</button>
                </div>

                <script>
                    const content = document.getElementById("content");
                    const vscode = acquireVsCodeApi();

                    function requestAction(type) {
                        // Send message to the Extension Host (SidebarProvider class)
                        vscode.postMessage({ 
                            command: 'requestMoreHelp', 
                            action: type 
                        });
                    }

                    window.addEventListener("message", event => {
                        const message = event.data;
                        if (message.type === "update") {
                            content.innerText = message.text;
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}