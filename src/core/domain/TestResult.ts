export type TestExecutionStatus = 'passed' | 'failed';

export interface TestResult {
  id: string;
  nameKey: string;
  descriptionKey: string;
  status: TestExecutionStatus;
  durationMs: number;
  errorMessage?: string;
}

export interface TestSuiteResult {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  executedAtUtc: string;
  executedAtJalali: string;
  results: TestResult[];
}
