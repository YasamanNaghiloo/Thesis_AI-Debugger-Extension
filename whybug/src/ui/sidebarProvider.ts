import * as vscode from "vscode";
import { DebugAssistantService } from "../services/debugAssistantService";

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "whybug.sidebar";
    private _view?: vscode.WebviewView;
    private isStreaming = false;

    constructor(private readonly context: vscode.ExtensionContext, private assistant: DebugAssistantService) { }

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
                    else if (data.action === 'analytics') {
                        const analytics = this.assistant.getErrorAnalytics();
                        response = this.formatAnalytics(analytics);
                    }

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

    private formatAnalytics(analytics: any[]): string {
        if (analytics.length === 0) {
            return "No errors tracked yet. Make some mistakes to see your error levels!";
        }

        const errorBlocks = analytics.map((a, idx) => {
            const timestampLines = a.timestamps.map((ts: number) => {
                const relativeTime = this.getRelativeTime(ts);
                const date = new Date(ts);
                const timeStr = date.toLocaleString();
                return `<div class="timestamp-item">${relativeTime} — ${timeStr}</div>`;
            }).join("");

            return `
            <div class="accordion-item">
                <div class="accordion-header" onclick="toggleAccordion(${idx})">
                    <span class="accordion-chevron" id="chevron-${idx}">▶</span>
                    <span class="accordion-title"><strong>${a.errorType}</strong></span>
                    <span class="accordion-score">Score: ${a.totalScore.toFixed(2)}</span>
                </div>
                <div class="accordion-content" id="content-${idx}" style="display: none;">
                    ${timestampLines}
                </div>
            </div>
            `;
        }).join("");

        return `
        <div id="analytics-container">
            <h2 style="margin-top: 0;">Your Error Profile</h2>
            <p style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 15px;">
                Click the arrow to expand and see when you made each mistake.
            </p>
            ${errorBlocks}
        </div>
        `;
    }

    private getRelativeTime(timestampMs: number): string {
        const now = Date.now();
        const diffMs = now - timestampMs;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (diffSec < 60) return `${diffSec}s ago`;
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHour < 24) return `${diffHour}h ago`;
        return `${diffDay}d ago`;
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

                    /* Accordion Styles */
                    #analytics-container {
                        width: 100%;
                    }

                    .accordion-item {
                        margin-bottom: 12px;
                        border-left: 3px solid var(--vscode-button-background);
                        padding: 0 0 0 10px;
                    }

                    .accordion-header {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 8px 0;
                        cursor: pointer;
                        user-select: none;
                        transition: opacity 0.2s;
                    }

                    .accordion-header:hover {
                        opacity: 0.8;
                    }

                    .accordion-chevron {
                        display: inline-block;
                        font-size: 10px;
                        transition: transform 0.2s;
                        width: 10px;
                        text-align: center;
                    }

                    .accordion-chevron.open {
                        transform: rotate(90deg);
                    }

                    .accordion-title {
                        flex: 1;
                        font-weight: bold;
                        color: var(--vscode-foreground);
                    }

                    .accordion-score {
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                        margin-left: auto;
                    }

                    .accordion-content {
                        display: none;
                        padding: 8px 0 8px 10px;
                        margin-bottom: 8px;
                        border-left: 1px dashed var(--vscode-descriptionForeground);
                        margin-left: -3px;
                        padding-left: 13px;
                    }

                    .accordion-content.open {
                        display: block;
                    }

                    .timestamp-item {
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                        padding: 4px 0;
                        word-wrap: break-word;
                    }
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
                        <button class="tutor-btn" onclick="requestAction('analytics')">
                            <span class="emoji">📊</span>
                            <span class="label">Analytics</span>
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

                    let currentOpenAccordion = null;

                    function toggleAccordion(index) {
                        const content = document.getElementById("content-" + index);
                        const chevron = document.getElementById("chevron-" + index);
                        const isOpen = content.style.display !== "none";

                        // Close the currently open accordion if it's a different one
                        if (currentOpenAccordion !== null && currentOpenAccordion !== index) {
                            const prevContent = document.getElementById("content-" + currentOpenAccordion);
                            const prevChevron = document.getElementById("chevron-" + currentOpenAccordion);
                            if (prevContent) {
                                prevContent.style.display = "none";
                                prevContent.classList.remove("open");
                            }
                            if (prevChevron) {
                                prevChevron.classList.remove("open");
                            }
                        }

                        // Toggle the clicked accordion
                        if (isOpen) {
                            content.style.display = "none";
                            content.classList.remove("open");
                            chevron.classList.remove("open");
                            currentOpenAccordion = null;
                        } else {
                            content.style.display = "block";
                            content.classList.add("open");
                            chevron.classList.add("open");
                            currentOpenAccordion = index;
                        }
                    }

                    window.addEventListener("message", event => {
                        const message = event.data;
                        if (message.type === "update") {
                            if (message.clear) {
                                content.innerHTML = "<i>Thinking...</i>";
                                stopBtn.style.display = "inline-block";
                            } else {
                                // Check if this is analytics (accordion) or regular markdown
                                if (message.text.includes("analytics-container")) {
                                    content.innerHTML = message.text;
                                } else {
                                    // Convert Markdown to HTML
                                    content.innerHTML = marked.parse(message.text);
                                }
                                
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