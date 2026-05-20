export type FinalTextResponse = {
  type: "final-text";
  text: string;
};

export type FunctionToolCall = {
  id?: string;
  name: string;
  arguments: string;
};

export type ToolCallsResponse = {
  type: "tool-calls";
  toolCalls: FunctionToolCall[];
};

export type ScriptedResponse = FinalTextResponse | ToolCallsResponse;

export type ScriptStep = {
  id?: string;
  respond: ScriptedResponse;
};

export type MockScript = {
  id: string;
  steps: ScriptStep[];
};

export type ScriptRuntime = {
  script: MockScript;
  nextStep(): ScriptStep;
};
