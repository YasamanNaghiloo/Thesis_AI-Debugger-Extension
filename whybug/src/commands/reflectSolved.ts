import * as vscode from "vscode";
import { DebugAssistantService } from "../services/debugAssistantService";
import { SidebarProvider } from "../ui/sidebarProvider";

export function registerReflectSolved(
  sidebar: SidebarProvider,
  assistant: DebugAssistantService
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "debugAssistant.reflectSolved",
    async () => {
      const reply = await assistant.reflectSolved();
      sidebar.update(reply);
    }
  );
}