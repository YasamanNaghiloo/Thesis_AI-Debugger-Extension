import * as vscode from "vscode";
import { DebugAssistantService } from "../services/debugAssistantService";

export function registerReflectSolved(): vscode.Disposable {
  const assistant = new DebugAssistantService();

  return vscode.commands.registerCommand(
    "debugAssistant.reflectSolved",
    async () => {
      const reply = await assistant.reflectSolved();
      vscode.window.showInformationMessage(reply);
    }
  );
}