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

export type ScriptedErrorResponse = {
  type: "error";
  status?: number;
  message: string;
  errorType?: string;
  param?: string;
  code?: string;
};

export type ScriptedDelayResponse = {
  type: "delay";
  ms: number;
  then: FinalTextResponse | ToolCallsResponse;
};

export type ScriptedMalformedResponse = {
  type: "malformed";
  status?: number;
  body: string;
  contentType?: string;
};

export type ScriptedTimeoutResponse = {
  type: "timeout";
  ms?: number;
};

export type TerminalScriptedResponse =
  | ScriptedErrorResponse
  | ScriptedMalformedResponse
  | ScriptedTimeoutResponse;

export type RenderableScriptedResponse = FinalTextResponse | ToolCallsResponse;

export type ScriptedResponse =
  | RenderableScriptedResponse
  | TerminalScriptedResponse
  | ScriptedDelayResponse;

export type ScriptStepMatch = {
  requestIndex?: number;
  apiSurface?: string;
  model?: string;
  body?: Record<string, unknown>;
  hasToolResult?: boolean;
  toolResultName?: string;
  priorToolCallName?: string;
};

export type ScriptStep = {
  id?: string;
  match?: ScriptStepMatch;
  respond: ScriptedResponse;
};

export type MockScript = {
  id: string;
  steps: ScriptStep[];
};

export type ScriptRuntime = {
  script: MockScript;
  replaceScript(script: MockScript): void;
  nextStep(context: {
    apiSurface: string;
    model?: string | null;
    requestBody: Record<string, unknown>;
  }): ScriptStep;
};
