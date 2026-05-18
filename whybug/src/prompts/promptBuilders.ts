export function buildExplainErrorPrompt(terminalOutput: string): string {
  return `You are WhyBug, a debugging tutor.

TASK:
- Read the terminal output below.
- Find only the error(s) that actually appear in the output. Do not assume anything else, only look at the provided terminal output below.
- For each error, explain what it means in plain language that a beginner would understand.
- Keep the response short and simple.
- Return exactly one bullet point per error and nothing else.
- Do not add any extra headings, preambles, or closing lines.

FORMAT:
- **ErrorType**: what this error means.

TERMINAL OUTPUT:
${terminalOutput}
`;
}

export function buildHintPrompt(terminalOutput: string, codeSnippet: string, line?: number): string {
  const lineContext = typeof line === 'number' && Number.isFinite(line) ? `The traceback points near line ${line}.` : 'The traceback line may be inferred from the terminal output.';

  return `You are WhyBug, an advanced debugging tutor.

TASK:
- Read the terminal traceback and the code snippet together.
- Focus on the specific traceback line and the surrounding code.
- Write in a natural, conversational flow that starts with observations and then asks helpful questions.
- Do not give a direct fix or rewrite the code.
- Write in a natural flow: start with a couple of observations, then end with a few helpful, guiding questions.
- Return short bullet points without numbering or labels.
- Keep each bullet to a few sentences.
- Do not add any extra headings, preambles, or closing lines.

${lineContext}

TERMINAL OUTPUT:
${terminalOutput}

CODE SNIPPET:
${codeSnippet}
`;
}

export function buildLevel3Prompt(terminalOutput: string, codeSnippet: string, line?: number): string {
  const lineContext = typeof line === 'number' && Number.isFinite(line) ? `The traceback points near line ${line}.` : 'The traceback line may be inferred from the terminal output.';
  return `You are WhyBug, a concise debugging tutor.

INSTRUCTIONS:
- Only use the provided TERMINAL OUTPUT and CODE SNIPPET. Do not assume anything else.
- Using the TERMINAL OUTPUT, find in the CODE SNIPPET where the error happened.
- Provide a few examples of concrete ways to fix this error.
- Ask socratic questions that guide the student into choosing what fix they should use and why for their context.

TERMINAL OUTPUT:
${terminalOutput}

CODE SNIPPET:
${codeSnippet}
`;
}

export function buildTermsPrompt(code: string): string {
  return `You are WhyBug, a debugging tutor.

TASK:
- Read the full code file below.
- Find the technical terms a beginner should know to understand this file.
- Focus on code concepts, not guesses about the author's intent.
- Do not assume anything about what the author is trying to do- just define what different asects of the code are in their most literal, defining sense.
- Put one term per line in this format: **term**: explanation.

CODE FILE:
${code}
`;
}

export function buildReflectionPrompt(): string {
  return `
The student solved the issue.
Help them reflect with bullet points only:
- What caused the bug?
- What debugging steps worked?
- How can this be prevented next time?
`;
}