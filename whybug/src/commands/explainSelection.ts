import * as vscode from "vscode";
import { DebugAssistantService } from "../services/debugAssistantService";
import { SidebarProvider } from "../ui/sidebarProvider";

export function registerExplainSelection(
  sidebar: SidebarProvider,
  assistant: DebugAssistantService
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "debugAssistant.explainSelection",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selectedText = editor.document.getText(editor.selection);
      if (!selectedText) return;

      try {
        const reply = await assistant.explainSelectedCode(selectedText);
        sidebar.update(reply);
      } catch (err) {
        sidebar.update("⚠️ AI error. Is Ollama running?");
      }
    }
  );
}