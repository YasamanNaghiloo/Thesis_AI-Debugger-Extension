import * as vscode from "vscode";
import { registerExplainError } from "./commands/explainError";
import { registerExplainSelection } from "./commands/explainSelection";
import { registerReflectSolved } from "./commands/reflectSolved";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(registerExplainError(context));
  context.subscriptions.push(registerExplainSelection());
  context.subscriptions.push(registerReflectSolved());

  vscode.window.showInformationMessage(
    "AI Debugging Assistant activated successfully."
  );
}

export function deactivate() {}