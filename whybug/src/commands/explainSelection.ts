import * as vscode from "vscode";
import { DebugAssistantService } from "../services/debugAssistantService";

export function registerExplainSelection(): vscode.Disposable {
  const assistant = new DebugAssistantService();

  return vscode.commands.registerCommand(
    "debugAssistant.explainSelection",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor.");
        return;
      }

      const selectedText = editor.document.getText(editor.selection);

      if (!selectedText) {
        vscode.window.showErrorMessage("Please select some code.");
        return;
      }

      const reply = await assistant.explainError(
        "Explain this selected code",
        selectedText,
        0
      );

      vscode.window.showInformationMessage(reply);
    }
  );
}