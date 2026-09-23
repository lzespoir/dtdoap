export type MapTheme = "light" | "dark";
export type OptimizationView = "before" | "after" | "delta";

export type WorkflowStep =
  | "idle"
  | "uploaded"
  | "extracting"
  | "before_shown"
  | "analyzing"
  | "params_shown"
  | "ask_after"
  | "after_shown";

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
  time: string;
}
