import * as vscode from "vscode";

export class TerminalOutputCapture {
    private outputBuffer: Map<vscode.Terminal, string> = new Map();
    private disposables: vscode.Disposable[] = [];

    private sanitizeTerminalData(data: string): string {
        return data
            .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "")
            .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, "")
            .replace(/\x1B[@-_][0-?]*[ -\/]*[@-~]/g, "");
    }

    public start() {
        console.log("🚀 TerminalOutputCapture started");
        
        // Listen for new terminals
        this.disposables.push(
            vscode.window.onDidOpenTerminal((terminal) => {
                console.log("New terminal opened");
                this.outputBuffer.set(terminal, "");
            })
        );

        if ((vscode.window as any).onDidStartTerminalShellExecution) {
            console.log("onDidStartTerminalShellExecution API available");
            this.disposables.push(
                (vscode.window as any).onDidStartTerminalShellExecution((event: any) => {
                    const terminal = event.terminal as vscode.Terminal;
                    this.outputBuffer.set(terminal, "");
                    console.log("Terminal shell execution started; buffer cleared.");
                })
            );
        } else {
            console.warn("onDidStartTerminalShellExecution API NOT available");
        }

        // Listen for closed terminals
        this.disposables.push(
            vscode.window.onDidCloseTerminal((terminal) => {
                console.log("Terminal closed");
                this.outputBuffer.delete(terminal);
            })
        );

        // Listen for terminal output (if API available)
        if ((vscode.window as any).onDidWriteTerminalData) {
            console.log("onDidWriteTerminalData API available");
            this.disposables.push(
                (vscode.window as any).onDidWriteTerminalData((event: any) => {
                    const terminal = event.terminal;
                    const data = this.sanitizeTerminalData(event.data || "");
                    if (!this.outputBuffer.has(terminal)) {
                        this.outputBuffer.set(terminal, "");
                    }
                    const current = this.outputBuffer.get(terminal) || "";
                    const updated = current + data;
                    this.outputBuffer.set(terminal, updated);
                    console.log("Terminal data captured, buffer size:", updated.length);
                })
            );
        } else {
            console.warn("onDidWriteTerminalData API NOT available");
        }
    }

    /**
     * Extract error types from terminal output
     * Looks for patterns like: NameError, ValueError, TypeError, IndexError, etc.
     */
    public extractErrorTypes(output: string): string[] {
        if (!output || output.length === 0) {
            console.log("No terminal output to parse");
            return [];
        }

        console.log("🔍 Full terminal output:\n", output);

        // Strategy 1: Look for lines that end with ": " (Python error format)
        // E.g., "TypeError: unsupported operand type(s) for +: 'int' and 'str'"
        const pythonErrorPattern = /^([A-Z][a-zA-Z]*(?:Error|Exception|Warning)):/gm;
        const pythonMatches = output.match(pythonErrorPattern);
        
        if (pythonMatches) {
            const errorTypes = pythonMatches
                .map(match => match.replace(":", "").trim())
                .filter(e => e.length > 0);
            
            const unique = [...new Set(errorTypes)];
            console.log("Python error types extracted:", unique);
            return unique;
        }

        // Strategy 2: Look for error words anywhere in output
        const generalErrorPattern = /([A-Z][a-zA-Z]*(?:Error|Exception|Warning))/g;
        const generalMatches = output.match(generalErrorPattern);
        
        if (generalMatches) {
            const unique = [...new Set(generalMatches)];
            console.log("General error types extracted:", unique);
            return unique;
        }

        console.log("No error patterns found in output");
        return [];
    }

    /**
     * Get the captured output for a specific terminal
     */
    public getOutputForTerminal(terminal: vscode.Terminal): string {
        const output = this.outputBuffer.get(terminal) || "";
        console.log("Terminal output length:", output.length);
        return output;
    }

    /**
     * Get the most recently active terminal output as a fallback.
     */
    public getLastOutput(): string {
        const terminals = vscode.window.terminals;
        if (terminals.length === 0) {
            console.log("No terminals available");
            return "";
        }

        const lastTerminal = terminals[terminals.length - 1];
        return this.getOutputForTerminal(lastTerminal);
    }

    /**
     * Clear the output buffer for a specific terminal.
     */
    public clearTerminal(terminal: vscode.Terminal) {
        this.outputBuffer.set(terminal, "");
        console.log("Cleared terminal buffer for execution");
    }

    /**
     * Clear the output buffer for all terminals
     */
    public clearBuffer() {
        this.outputBuffer.forEach((_, terminal) => {
            this.outputBuffer.set(terminal, "");
        });
        console.log("Terminal output buffer cleared");
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        console.log("TerminalOutputCapture disposed");
    }
}
