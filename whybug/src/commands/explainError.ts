import * as vscode from "vscode";
import { ErrorTracker } from "../services/errorTracker";
import { DebugAssistantService } from "../services/debugAssistantService";
import { SidebarProvider } from "../ui/sidebarProvider";

export function registerExplainError(
  context: vscode.ExtensionContext,
  sidebar: SidebarProvider,
  assistant: DebugAssistantService
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "debugAssistant.explainError",
    async () => {
      const error = await vscode.window.showInputBox({
        prompt: "Paste the error message"
      });

      if (!error) return;

      try {
        const reply = await assistant.explainError(error);
        sidebar.update(reply);
      } catch (err) {
        sidebar.update("⚠️ AI error. Is Ollama running?");
      }
    }
  );
}