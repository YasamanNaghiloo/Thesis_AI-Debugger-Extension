import * as vscode from "vscode";
import { DebugAssistantService } from "../services/debugAssistantService";
import { SidebarProvider } from "../ui/sidebarProvider";

export function registerExplainSelection(
  sidebar: SidebarProvider
): vscode.Disposable {
  const assistant = new DebugAssistantService();

  return vscode.commands.registerCommand(
    "debugAssistant.explainSelection",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selectedText = editor.document.getText(editor.selection);
      if (!selectedText) return;

      const reply = await assistant.explainError(
        "Explain this selected code",
        selectedText,
        0
      );

      sidebar.update(reply);
    }
  );
}