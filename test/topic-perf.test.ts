import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginTopicActivation,
  clearTopicPerf,
  finishTopicActivation,
  getTopicPerfRequestSnapshot,
  getTopicPerfSnapshot,
  getTopicPerfSummary,
  markTopicPerfStage,
  noteTopicRouteDetected,
  noteTopicRouteLeft,
  recordTopicRequest,
  setTopicPerfInitialPage,
} from '../src/content/topic-perf';

describe('topic performance timeline', () => {
  beforeEach(() => {
    clearTopicPerf();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearTopicPerf();
    vi.restoreAllMocks();
  });

  it('creates unique activations with stages, page, requests, and terminal states', async () => {
    const route = { topicId: '123', floor: 40 };
    noteTopicRouteDetected(route);
    const first = beginTopicActivation(route, 'hit');
    setTopicPerfInitialPage(first, 2);
    markTopicPerfStage(first, 'shell');
    await recordTopicRequest(route, 'posts', 'retry', async () => ({
      value: undefined,
      status: 200,
    }));
    finishTopicActivation(first, 'active');

    const second = beginTopicActivation(route, 'miss');
    finishTopicActivation(second, 'aborted');
    const snapshot = getTopicPerfSnapshot();

    expect(first).not.toBe(second);
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).toMatchObject({
      topicId: '123',
      floor: 40,
      initialPage: 2,
      prefetch: 'hit',
      finalState: 'active',
    });
    expect(snapshot[0]?.stages.shell).toBeTypeOf('number');
    expect(snapshot[0]?.requests).toMatchObject([
      { topicId: '123', floor: 40, kind: 'posts', source: 'retry', status: 200 },
    ]);
    expect(snapshot[1]?.finalState).toBe('aborted');
    expect(getTopicPerfRequestSnapshot()).toHaveLength(1);
    expect(getTopicPerfSummary()).toMatchObject({
      totalRequests: 1,
      requestsBySource: { prefetch: 0, activation: 0, retry: 1 },
      prefetchHits: 1,
      prefetchMisses: 1,
    });
  });

  it('keeps only the latest 20 completed activations', () => {
    const route = { topicId: '123' };
    noteTopicRouteDetected(route);
    const ids: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const activationId = beginTopicActivation(route, 'none');
      ids.push(activationId);
      finishTopicActivation(activationId, index % 2 === 0 ? 'failed' : 'active');
    }

    const snapshot = getTopicPerfSnapshot();
    expect(snapshot).toHaveLength(20);
    expect(snapshot.map((entry) => entry.activationId)).toEqual(ids.slice(5));
  });

  it('starts a new route observation after leaving and returning to the same topic', () => {
    const route = { topicId: '123' };
    noteTopicRouteDetected(route);
    const first = beginTopicActivation(route, 'none');
    const firstStart = getTopicPerfSnapshot()[0]?.startedAt;
    finishTopicActivation(first, 'active');
    noteTopicRouteLeft();
    noteTopicRouteDetected(route);
    const second = beginTopicActivation(route, 'none');

    expect(
      getTopicPerfSnapshot().find((entry) => entry.activationId === second)?.startedAt,
    ).toBeGreaterThanOrEqual(firstStart || 0);
  });
});
