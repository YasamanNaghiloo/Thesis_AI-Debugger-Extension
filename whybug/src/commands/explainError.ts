import * as vscode from "vscode";
import { ErrorTracker } from "../services/errorTracker";
import { DebugAssistantService } from "../services/debugAssistantService";

export function registerExplainError(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const tracker = new ErrorTracker(context);
  const assistant = new DebugAssistantService();

  return vscode.commands.registerCommand(
    "debugAssistant.explainError",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor found.");
        return;
      }

      const code = editor.document.getText();

      const error = await vscode.window.showInputBox({
        prompt: "Paste the error message"
      });

      if (!error) return;

      const count = await tracker.incrementError(error);
      const reply = await assistant.explainError(error, code, count);

      vscode.window.showInformationMessage(reply);
    }
  );
}