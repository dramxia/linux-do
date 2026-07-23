import { describe, it, expect } from 'vitest';
import { assertExportResult, getExportToastPrefix } from '../src/content/messages';
import type { ExportResult } from '../src/content/post-export';

function makeResult(overrides: Partial<ExportResult> = {}): ExportResult {
  return {
    posts: [],
    failures: [],
    total: 0,
    successCount: 0,
    failureCount: 0,
    ...overrides,
  };
}

describe('assertExportResult', () => {
  it('throws when total is zero (no loaded posts detected)', () => {
    expect(() => assertExportResult(makeResult({ total: 0 }))).toThrow(
      '当前页面没有检测到已加载楼层',
    );
  });

  it('throws when successCount is zero even if total > 0 (all failed)', () => {
    expect(() =>
      assertExportResult(makeResult({ total: 3, successCount: 0, failureCount: 3 })),
    ).toThrow('已加载楼层全部导出失败');
  });

  it('does not throw when all posts succeeded', () => {
    expect(() =>
      assertExportResult(makeResult({ total: 5, successCount: 5, failureCount: 0 })),
    ).not.toThrow();
  });

  it('does not throw on partial failure (some succeeded, some failed)', () => {
    expect(() =>
      assertExportResult(makeResult({ total: 4, successCount: 3, failureCount: 1 })),
    ).not.toThrow();
  });

  it('throws the specific zero-total message before the zero-success message', () => {
    // total=0 AND successCount=0 — the total check is first.
    expect(() => assertExportResult(makeResult({ total: 0, successCount: 0 }))).toThrow(
      '当前页面没有检测到已加载楼层',
    );
  });
});

describe('getExportToastPrefix', () => {
  it('returns ✅ when there are no failures', () => {
    expect(getExportToastPrefix(makeResult({ total: 5, successCount: 5, failureCount: 0 }))).toBe(
      '✅',
    );
  });

  it('returns ✅ even when total is zero but failureCount is zero', () => {
    // getExportToastPrefix is called AFTER assertExportResult in messages.ts,
    // so this is a defensive check on the function's own contract.
    expect(getExportToastPrefix(makeResult({ total: 0, successCount: 0, failureCount: 0 }))).toBe(
      '✅',
    );
  });

  it('returns a warning summary string when there are some failures', () => {
    const prefix = getExportToastPrefix(makeResult({ total: 4, successCount: 3, failureCount: 1 }));
    expect(prefix).toBe('⚠️ 已处理 3/4 个楼层，1 个失败。');
  });

  it('includes successCount/total/failureCount in the warning string', () => {
    const prefix = getExportToastPrefix(
      makeResult({ total: 10, successCount: 7, failureCount: 3 }),
    );
    expect(prefix).toContain('7/10');
    expect(prefix).toContain('3 个失败');
  });

  it('handles all-failed case (failureCount === total)', () => {
    // Note: this would normally be preceded by assertExportResult throwing,
    // but getExportToastPrefix itself does not throw.
    const prefix = getExportToastPrefix(makeResult({ total: 5, successCount: 0, failureCount: 5 }));
    expect(prefix).toBe('⚠️ 已处理 0/5 个楼层，5 个失败。');
  });
});
