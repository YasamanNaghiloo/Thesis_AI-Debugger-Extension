export interface AIProvider {
  ask(prompt: string): Promise<string>;
}