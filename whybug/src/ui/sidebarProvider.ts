import * as vscode from "vscode";
import { DebugAssistantService } from "../services/debugAssistantService";
import { ErrorTracker } from "../services/errorTracker";

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "whybug.sidebar";

    private _view?: vscode.WebviewView;
    private assistant = new DebugAssistantService();
    private tracker: ErrorTracker;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.tracker = new ErrorTracker(context);
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const code = editor.document.getText();

            if (data.command === 'requestMoreHelp') {
                this.postMessage("", true); // Clear UI
                let prompt = "";
                if (data.action === 'hint') prompt = "Give me a tiny hint. Do NOT solve it.";
                else if (data.action === 'term') prompt = "Explain the technical terms simply.";
                else if (data.action === 'eli5') prompt = "Explain this like I'm 5 with an analogy.";

                try {
                    const response = await this.assistant.askCustom(prompt, code);
                    this.streamResponse(response);
                } catch (err) {
                    this.update("⚠️ AI error. Is Ollama running?");
                }
            }
        });
    }

    public async streamResponse(fullText: string) {
        let currentText = "";
        for (const char of fullText.split("")) {
            currentText += char;
            this.postMessage(currentText, false);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    public update(text: string) { this.postMessage(text, false); }

    private postMessage(text: string, clear: boolean) {
        this._view?.webview.postMessage({ type: "update", text, clear });
    }

    private getHtml() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    * { box-sizing: border-box; }
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 12px;
                        margin: 0;
                        color: var(--vscode-foreground);
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        gap: 20px;
                        overflow: hidden;
                    }
                    h3 { 
                        font-size: 10px; font-weight: bold; text-transform: uppercase;
                        margin: 0 0 10px 0; opacity: 0.7; color: var(--vscode-descriptionForeground);
                    }
                    .button-group { 
                        display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; 
                    }
                    .tutor-btn {
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none; padding: 15px 5px; cursor: pointer;
                        border-radius: 8px; display: flex; flex-direction: column;
                        align-items: center; gap: 8px;
                    }
                    .tutor-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
                    .tutor-btn .emoji { font-size: 24px; }
                    .tutor-btn .label { font-size: 14px; font-weight: bold; }

                    .output-container {
                        flex: 1; display: flex; flex-direction: column;
                        overflow: hidden; min-height: 0;
                    }
                    #content {
                        flex: 1; overflow-y: auto; white-space: pre-wrap;
                        background: var(--vscode-textBlockQuote-background);
                        padding: 15px; border-radius: 6px;
                        border-left: 4px solid var(--vscode-button-background);
                        font-size: 13px; line-height: 1.6;
                    }
                </style>
            </head>
            <body>
                <div>
                    <h3>Tutor Actions</h3>
                    <div class="button-group">
                        <button class="tutor-btn" onclick="requestAction('hint')">
                            <span class="emoji">💡</span>
                            <span class="label">Hint</span>
                        </button>
                        <button class="tutor-btn" onclick="requestAction('term')">
                            <span class="emoji">📖</span>
                            <span class="label">Terms</span>
                        </button>
                        <button class="tutor-btn" onclick="requestAction('eli5')">
                            <span class="emoji">🐥</span>
                            <span class="label">ELI5</span>
                        </button>
                    </div>
                </div>

                <div class="output-container">
                    <h3>AI Guidance</h3>
                    <div id="content">Run your code in the terminal to see errors...</div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const content = document.getElementById("content");

                    function requestAction(type) {
                        vscode.postMessage({ command: 'requestMoreHelp', action: type });
                    }

                    window.addEventListener("message", event => {
                        const message = event.data;
                        if (message.clear) {
                            content.innerText = "🤔 Thinking...";
                        } else {
                            content.innerText = message.text;
                            content.scrollTop = content.scrollHeight;
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}