export function buildExplainErrorPrompt(error: string, code: string): string {
  return `
You are an AI debugging tutor for beginner programmers.
Do NOT directly solve the issue.
Explain the error in simple words.
Suggest debugging steps.
Ask guiding questions.

ERROR:
${error}

CODE:
${code}
`;
}

export function buildELI5Prompt(error: string, code: string): string {
  return `
This error has happened many times.
Explain it like I am 5 years old.
Use simple real-life analogies.
Do NOT directly fix the code.

ERROR:
${error}

CODE:
${code}
`;
}

export function buildReflectionPrompt(): string {
  return `
The student solved the issue.
Help them reflect:
1. What caused the bug?
2. What debugging steps worked?
3. How can this be prevented next time?
`;
}