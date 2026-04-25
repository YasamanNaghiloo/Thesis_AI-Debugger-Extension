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
        webviewView.webview.options = { 
            enableScripts: true, 
            localResourceRoots: [this.context.extensionUri] 
        };
        
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const code = editor.document.getText();

            if (data.command === 'requestMoreHelp') {
                this.postMessage("", true); // Clear UI and show "Thinking..."
                
                try {
                    let response = "";
                    
                    // Explicitly define what each button does based on user action
                    if (data.action === 'hint') {
                        response = await this.assistant.askCustom(
                            "Based on the current code, give me one tiny hint to help me find the bug myself. Do NOT show the solution.", 
                            code
                        );
                    } 
                    else if (data.action === 'term') {
                        response = await this.assistant.askCustom(
                            "Identify the technical programming terms related to the current error and explain them simply.", 
                            code
                        );
                    } 
                    else if (data.action === 'eli5') {
                        response = await this.assistant.askCustom(
                            "Explain the current bug using a real-world analogy as if I am 5 years old. Do not provide the code fix.", 
                            code
                        );
                    }

                    this.streamResponse(response);
                } catch (err) {
                    this.update("⚠️ AI error. Is Ollama running?");
                }
            }
        });
    }

    /**
     * Simulates a typewriter effect by sending text letter by letter to the webview
     */
    public async streamResponse(fullText: string) {
        let currentText = "";
        const characters = fullText.split("");
        
        for (const char of characters) {
            currentText += char;
            this.postMessage(currentText, false);
            // Delay of 10ms creates a smooth "AI typing" feel
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    public update(text: string) { 
        this.postMessage(text, false); 
    }

    private postMessage(text: string, clear: boolean) {
        this._view?.webview.postMessage({ 
            type: "update", 
            text: text, 
            clear: clear 
        });
    }

    private getHtml() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    /* Ensure borders and padding are calculated correctly so nothing is cut off */
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
                        font-size: 10px; 
                        font-weight: bold; 
                        text-transform: uppercase;
                        margin: 0 0 10px 0; 
                        opacity: 0.7; 
                        color: var(--vscode-descriptionForeground);
                    }
                    
                    .button-group { 
                        display: grid; 
                        grid-template-columns: 1fr 1fr 1fr; 
                        gap: 10px; 
                    }
                    
                    .tutor-btn {
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none; 
                        padding: 15px 5px; 
                        cursor: pointer;
                        border-radius: 8px; 
                        display: flex; 
                        flex-direction: column;
                        align-items: center; 
                        gap: 8px;
                        transition: background 0.2s;
                    }
                    
                    .tutor-btn:hover { 
                        background: var(--vscode-button-secondaryHoverBackground); 
                    }
                    
                    .tutor-btn .emoji { font-size: 24px; }
                    .tutor-btn .label { font-size: 14px; font-weight: bold; }

                    .output-container {
                        flex: 1; 
                        display: flex; 
                        flex-direction: column;
                        overflow: hidden; 
                        min-height: 0;
                    }
                    
                    #content {
                        flex: 1; 
                        overflow-y: auto; 
                        white-space: pre-wrap;
                        background: var(--vscode-textBlockQuote-background);
                        padding: 15px; 
                        border-radius: 6px;
                        border-left: 4px solid var(--vscode-button-background);
                        font-size: 13px; 
                        line-height: 1.6;
                        word-wrap: break-word;
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
                            // Auto-scroll to the bottom as text streams in
                            content.scrollTop = content.scrollHeight;
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}