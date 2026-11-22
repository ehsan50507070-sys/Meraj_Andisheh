import type { IClock } from '../core/abstractions/IClock';
import type { TestResult, TestSuiteResult } from '../core/domain/TestResult';

export interface UnitTestCase {
  id: string;
  nameKey: string;
  descriptionKey: string;
  run: () => Promise<void> | void;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected=${String(expected)}, actual=${String(actual)})`);
  }
}

export async function runUnitTests(
  testCases: UnitTestCase[],
  clock: IClock,
): Promise<TestSuiteResult> {
  const suiteStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const results: TestResult[] = [];

  for (const testCase of testCases) {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      await testCase.run();
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      results.push({
        id: testCase.id,
        nameKey: testCase.nameKey,
        descriptionKey: testCase.descriptionKey,
        status: 'passed',
        durationMs: Math.max(1, Math.round(end - start)),
      });
    } catch (error) {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      results.push({
        id: testCase.id,
        nameKey: testCase.nameKey,
        descriptionKey: testCase.descriptionKey,
        status: 'failed',
        durationMs: Math.max(1, Math.round(end - start)),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const suiteEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const passed = results.filter((item) => item.status === 'passed').length;
  const failed = results.length - passed;

  return {
    total: results.length,
    passed,
    failed,
    durationMs: Math.max(1, Math.round(suiteEnd - suiteStart)),
    executedAtUtc: clock.nowUtcIso(),
    executedAtJalali: clock.nowJalali(),
    results,
  };
}
