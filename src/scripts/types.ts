export type FinalTextResponse = {
  type: "final-text";
  text: string;
};

export type ScriptedResponse = FinalTextResponse;

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
