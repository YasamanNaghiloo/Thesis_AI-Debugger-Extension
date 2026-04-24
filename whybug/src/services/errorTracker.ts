import * as vscode from "vscode";

export class ErrorTracker {
  constructor(private context: vscode.ExtensionContext) {}

  async incrementError(error: string): Promise<number> {
    const key = `error:${error}`;
    const current = this.context.workspaceState.get<number>(key, 0);
    const updated = current + 1;

    await this.context.workspaceState.update(key, updated);
    return updated;
  }
}