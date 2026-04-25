import * as vscode from "vscode";
import { DebugAssistantService } from "../services/debugAssistantService";

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "whybug.sidebar";
    private _view?: vscode.WebviewView;
    private assistant = new DebugAssistantService();
    private isStreaming = false;

    constructor(private readonly context: vscode.ExtensionContext) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.command === 'stopGeneration') {
                this.isStreaming = false;
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const code = editor.document.getText();

            if (data.command === 'requestMoreHelp') {
                this.postMessage("", true);
                try {
                    let response = "";
                    if (data.action === 'hint') response = await this.assistant.askCustom("Give me a tiny hint. Do NOT solve it.", code);
                    else if (data.action === 'term') response = await this.assistant.askCustom("Explain the technical terms simply.", code);
                    else if (data.action === 'eli5') response = await this.assistant.askCustom("Explain this like I'm 5 with an analogy.", code);

                    this.streamResponse(response);
                } catch (err) {
                    this.update("⚠️ AI error. Is Ollama running?");
                }
            }
        });
    }

    public async streamResponse(fullText: string) {
        this.isStreaming = true;
        this.postMessage("", true);
        let currentText = "";
        for (const char of fullText.split("")) {
            if (!this.isStreaming) break;
            currentText += char;
            this.postMessage(currentText, false);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        this.isStreaming = false;
        this._view?.webview.postMessage({ type: "finished" });
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
                <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
                <style>
                    * { box-sizing: border-box; }
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 12px; margin: 0;
                        color: var(--vscode-foreground);
                        display: flex; flex-direction: column;
                        height: 100vh; 
                        gap: 15px; 
                        overflow: hidden;
                    }
                    h3 { 
                        font-size: 10px; font-weight: bold; text-transform: uppercase;
                        margin: 0; opacity: 0.7; color: var(--vscode-descriptionForeground);
                    }
                    .header-row {
                        display: flex; 
                        justify-content: space-between; 
                        align-items: center;
                        margin-bottom: 8px;
                        min-height: 20px;
                    }
                    .button-group { 
                        display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; 
                        flex-shrink: 0;
                    }
                    .tutor-btn {
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none; padding: 12px 5px; cursor: pointer;
                        border-radius: 8px; display: flex; flex-direction: column;
                        align-items: center; gap: 5px;
                    }
                    .tutor-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
                    .tutor-btn .emoji { font-size: 20px; }
                    .tutor-btn .label { font-size: 12px; font-weight: bold; }

                    #stopBtn {
                        background: #d73a49; 
                        color: white; 
                        border: none;
                        padding: 4px 10px; 
                        border-radius: 4px; 
                        cursor: pointer;
                        font-size: 10px; 
                        font-weight: bold;
                        display: none;
                    }

                    .output-container {
                        flex: 1; 
                        display: flex; 
                        flex-direction: column;
                        min-height: 0;
                    }
                    
                    #content {
                        flex: 1; 
                        overflow-y: auto; 
                        background: var(--vscode-textBlockQuote-background);
                        padding: 12px; 
                        border-radius: 6px;
                        border-left: 4px solid var(--vscode-button-background);
                        font-size: 13px; 
                        line-height: 1.5;
                        word-wrap: break-word;
                    }

                    /* Markdown Specific Styles */
                    #content strong { 
                        color: var(--vscode-symbolIcon-keywordForeground); 
                        font-weight: bold;
                    }
                    #content ul { margin: 0; padding-left: 18px; }
                    #content li { margin-bottom: 10px; }
                    #content p { margin: 0 0 10px 0; }
                </style>
            </head>
            <body>
                <div style="flex-shrink: 0;">
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
                    <div class="header-row">
                        <h3>AI Guidance</h3>
                        <button id="stopBtn" onclick="stopGen()">⏹ STOP</button>
                    </div>
                    <div id="content">Run your code to see errors...</div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const content = document.getElementById("content");
                    const stopBtn = document.getElementById("stopBtn");
                    let userIsScrolling = false;

                    content.addEventListener('wheel', () => {
                        userIsScrolling = true;
                        setTimeout(() => { userIsScrolling = false; }, 2000);
                    });

                    function requestAction(type) {
                        vscode.postMessage({ command: 'requestMoreHelp', action: type });
                    }

                    function stopGen() {
                        vscode.postMessage({ command: 'stopGeneration' });
                        stopBtn.style.display = "none";
                    }

                    window.addEventListener("message", event => {
                        const message = event.data;
                        if (message.type === "update") {
                            if (message.clear) {
                                content.innerHTML = "🤔 <i>Thinking...</i>";
                                stopBtn.style.display = "inline-block";
                            } else {
                                // Convert Markdown to HTML
                                content.innerHTML = marked.parse(message.text);
                                
                                if (!userIsScrolling) {
                                    content.scrollTop = content.scrollHeight;
                                }
                            }
                        } else if (message.type === "finished") {
                            stopBtn.style.display = "none";
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}