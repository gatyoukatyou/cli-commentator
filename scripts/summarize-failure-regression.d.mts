export type StructuredLogParseError = {
  lineNumber: number;
  message: string;
};

export type StructuredLogParseResult = {
  startupFailures: Record<string, unknown>[];
  serverStateEvents: Record<string, unknown>[];
  parseErrors: StructuredLogParseError[];
};

export type StructuredLogCount = {
  value: string;
  count: number;
};

export type StructuredLogScenarioSummary = {
  scenario: string;
  fileName: string;
  startupFailureCount: number;
  serverStateEventCount: number;
  startupCodes: string[];
  startupFallbackReasons: string[];
  startupContexts: string[];
  stateTriggers: string[];
  parseErrors: StructuredLogParseError[];
};

export type StructuredLogCaptureSummary = {
  found: boolean;
  captureDir?: string;
  captureFiles: string[];
  scenarioCount: number;
  startupFailureCount: number;
  serverStateEventCount: number;
  startupFailureCodes: StructuredLogCount[];
  fallbackReasons: StructuredLogCount[];
  serverStateTriggers: StructuredLogCount[];
  scenarios: StructuredLogScenarioSummary[];
  parseErrors: Array<StructuredLogParseError & { fileName: string }>;
};

export function parseStructuredLogLines(raw: string): StructuredLogParseResult;

export function collectStructuredLogCaptureSummary(captureDir?: string): Promise<StructuredLogCaptureSummary>;

export function summarizeFailureRegression(params: {
  reportPath: string;
  outputPath?: string;
  captureDir?: string;
}): Promise<void>;
