import * as vscode from "vscode";

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "whybug.sidebar";

    private _view?: vscode.WebviewView;
    private _pendingMessage: string | null = null;

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

        // If a message came in before the sidebar was opened, send it now
        if (this._pendingMessage) {
            this.postMessage(this._pendingMessage);
            this._pendingMessage = null;
        }
    }

    public update(text: string) {
        if (!this._view) {
            // Store message and try to force the view to open
            this._pendingMessage = text;
            vscode.commands.executeCommand('workbench.view.extension.whybug-container');
            return;
        }

        // Make sure the sidebar is visible
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
                    }
                    h3 { color: var(--vscode-button-background); }
                </style>
            </head>
            <body>
                <h3>🧠 WhyBug AI Assistant</h3>
                <div id="content">Waiting for code errors...</div>

                <script>
                    const content = document.getElementById("content");
                    const vscode = acquireVsCodeApi();

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