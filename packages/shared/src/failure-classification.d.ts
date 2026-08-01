export type FailureKind =
  | "type-error"
  | "port-in-use"
  | "permission"
  | "module-not-found"
  | "command-not-found"
  | "exit-code";

export declare function classifyFailure(detail?: string): FailureKind | null;
