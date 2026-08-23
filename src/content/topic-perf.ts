/* Linux.do 工具箱 - 双栏阅读阶段时间线 */

import { getTopicIdentityKey, type TopicRoute } from '../common/topic-route';

const HISTORY_LIMIT = 20;
const REQUEST_HISTORY_LIMIT = 200;
const PREFETCH_TTL_MS = 15_000;
const MARK_PREFIX = 'ldtk';

export type TopicPerfFinalState = 'active' | 'failed' | 'aborted' | 'unsupported' | 'native';
export type TopicRequestKind = 'topic' | 'posts' | 'article-replies' | 'reply-targets';
export type TopicRequestSource = 'prefetch' | 'activation' | 'retry';

export interface TopicPerfRequest {
  topicId: string;
  floor?: number;
  activationId?: string;
  kind: TopicRequestKind;
  source: TopicRequestSource;
  startedAt: number;
  endedAt?: number;
  status?: number | 'failed' | 'aborted';
  abortReason?: string;
}

export interface TopicPerfEntry {
  activationId: string;
  topicId: string;
  floor?: number;
  initialPage?: number;
  prefetch: 'hit' | 'miss' | 'none';
  startedAt: number;
  stages: Record<string, number>;
  requests: TopicPerfRequest[];
  finalState?: TopicPerfFinalState;
  endedAt?: number;
}

interface RouteObservation {
  detectedAt: number;
  requests: TopicPerfRequest[];
}

interface TopicPerfDebugApi {
  snapshot: () => TopicPerfEntry[];
  requests: () => TopicPerfRequest[];
  summary: () => TopicPerfSummary;
  clear: () => void;
}

export interface TopicPerfSummary {
  totalRequests: number;
  requestsBySource: Record<TopicRequestSource, number>;
  prefetchHits: number;
  prefetchMisses: number;
  wastedPrefetches: number;
}

let activationSequence = 0;
let currentRouteKey: string | null = null;
const routeObservations = new Map<string, RouteObservation>();
const activeEntries = new Map<string, TopicPerfEntry>();
const activeActivationByRoute = new Map<string, string>();
const history: TopicPerfEntry[] = [];
const requestHistory: TopicPerfRequest[] = [];

function now(): number {
  return performance.now();
}

function safeMark(name: string, startTime?: number): void {
  try {
    performance.mark(name, startTime === undefined ? undefined : { startTime });
  } catch {
    // Performance marks are diagnostic and must never affect loading.
  }
}

function safeMeasure(name: string, startMark: string, endMark: string): void {
  try {
    performance.clearMeasures(name);
    performance.measure(name, startMark, endMark);
  } catch {
    // Performance measures are diagnostic and must never affect loading.
  }
}

function routeKey(route: TopicRoute): string {
  return getTopicIdentityKey(route) || route.topicId;
}

function cloneEntry(entry: TopicPerfEntry): TopicPerfEntry {
  return {
    ...entry,
    stages: { ...entry.stages },
    requests: entry.requests.map((request) => ({ ...request })),
  };
}

function exposeDebugApi(): void {
  if (typeof window === 'undefined') return;
  const target = window as Window & { __ldtkPerf?: TopicPerfDebugApi };
  target.__ldtkPerf = {
    snapshot: getTopicPerfSnapshot,
    requests: getTopicPerfRequestSnapshot,
    summary: getTopicPerfSummary,
    clear: clearTopicPerf,
  };
}

export function noteTopicRouteDetected(route: TopicRoute): void {
  const key = routeKey(route);
  if (currentRouteKey === key) return;
  currentRouteKey = key;
  routeObservations.set(key, { detectedAt: now(), requests: [] });
}

export function noteTopicRouteLeft(): void {
  currentRouteKey = null;
}

export function beginTopicActivation(
  route: TopicRoute,
  prefetch: TopicPerfEntry['prefetch'],
): string {
  const key = routeKey(route);
  const observation = routeObservations.get(key) || { detectedAt: now(), requests: [] };
  routeObservations.set(key, observation);
  const activationId = `${route.topicId}-${++activationSequence}`;
  const entry: TopicPerfEntry = {
    activationId,
    topicId: route.topicId,
    ...(route.floor === undefined ? {} : { floor: route.floor }),
    prefetch,
    startedAt: observation.detectedAt,
    stages: { route_detected: observation.detectedAt },
    requests: observation.requests.splice(0),
  };
  entry.requests.forEach((request) => {
    request.activationId = activationId;
  });
  activeEntries.set(activationId, entry);
  activeActivationByRoute.set(key, activationId);
  safeMark(`${MARK_PREFIX}:${activationId}:route_detected`, observation.detectedAt);
  markTopicPerfStage(activationId, 'activate');
  exposeDebugApi();
  return activationId;
}

export function setTopicPerfInitialPage(activationId: string, initialPage: number): void {
  const entry = activeEntries.get(activationId);
  if (entry) entry.initialPage = initialPage;
}

export function markTopicPerfStage(activationId: string, stage: string): void {
  const entry = activeEntries.get(activationId);
  if (!entry || entry.finalState) return;
  const timestamp = now();
  entry.stages[stage] = timestamp;
  const stageMark = `${MARK_PREFIX}:${activationId}:${stage}`;
  safeMark(stageMark, timestamp);
  safeMeasure(
    `${MARK_PREFIX}:${activationId}:route_to_${stage}`,
    `${MARK_PREFIX}:${activationId}:route_detected`,
    stageMark,
  );
}

export function finishTopicActivation(activationId: string, finalState: TopicPerfFinalState): void {
  const entry = activeEntries.get(activationId);
  if (!entry || entry.finalState) return;
  entry.finalState = finalState;
  entry.endedAt = now();
  entry.stages[finalState] = entry.endedAt;
  const finalMark = `${MARK_PREFIX}:${activationId}:${finalState}`;
  safeMark(finalMark, entry.endedAt);
  safeMeasure(
    `${MARK_PREFIX}:${activationId}:route_to_${finalState}`,
    `${MARK_PREFIX}:${activationId}:route_detected`,
    finalMark,
  );
  activeEntries.delete(activationId);
  const key = routeKey({ topicId: entry.topicId, floor: entry.floor });
  if (activeActivationByRoute.get(key) === activationId) activeActivationByRoute.delete(key);
  history.push(entry);
  if (history.length > HISTORY_LIMIT) {
    history
      .splice(0, history.length - HISTORY_LIMIT)
      .forEach((expired) => clearActivationPerformanceEntries(expired.activationId));
  }
  console.debug('[Linux.do 工具箱] 双栏阅读性能', cloneEntry(entry));
}

export async function recordTopicRequest<T>(
  route: TopicRoute,
  kind: TopicRequestKind,
  source: TopicRequestSource,
  task: () => Promise<{ value: T; status: number }>,
): Promise<T> {
  const key = routeKey(route);
  const observation = routeObservations.get(key) || { detectedAt: now(), requests: [] };
  routeObservations.set(key, observation);
  const request: TopicPerfRequest = {
    topicId: route.topicId,
    ...(route.floor === undefined ? {} : { floor: route.floor }),
    kind,
    source,
    startedAt: now(),
  };
  const activationId = activeActivationByRoute.get(key);
  const entry = activationId ? activeEntries.get(activationId) : undefined;
  if (activationId) request.activationId = activationId;
  (entry?.requests || observation.requests).push(request);
  requestHistory.push(request);
  if (requestHistory.length > REQUEST_HISTORY_LIMIT) {
    requestHistory.splice(0, requestHistory.length - REQUEST_HISTORY_LIMIT);
  }
  try {
    const result = await task();
    request.status = result.status;
    return result.value;
  } catch (error) {
    request.status = (error as Error).name === 'AbortError' ? 'aborted' : 'failed';
    if (request.status === 'aborted') request.abortReason = 'signal';
    throw error;
  } finally {
    request.endedAt = now();
  }
}

export function getTopicPerfSnapshot(): TopicPerfEntry[] {
  return [...history, ...activeEntries.values()].map(cloneEntry);
}

export function getTopicPerfRequestSnapshot(): TopicPerfRequest[] {
  return requestHistory.map((request) => ({ ...request }));
}

export function getTopicPerfSummary(): TopicPerfSummary {
  const requestsBySource: Record<TopicRequestSource, number> = {
    prefetch: 0,
    activation: 0,
    retry: 0,
  };
  requestHistory.forEach((request) => {
    requestsBySource[request.source] += 1;
  });
  const entries = [...history, ...activeEntries.values()];
  return {
    totalRequests: requestHistory.length,
    requestsBySource,
    prefetchHits: entries.filter((entry) => entry.prefetch === 'hit').length,
    prefetchMisses: entries.filter((entry) => entry.prefetch === 'miss').length,
    wastedPrefetches: requestHistory.filter(
      (request) =>
        request.source === 'prefetch' &&
        !request.activationId &&
        (request.status === 'aborted' ||
          (request.endedAt !== undefined && now() - request.endedAt >= PREFETCH_TTL_MS)),
    ).length,
  };
}

function clearActivationPerformanceEntries(activationId: string): void {
  const prefix = `${MARK_PREFIX}:${activationId}:`;
  performance
    .getEntries()
    .filter((entry) => entry.name.startsWith(prefix))
    .forEach((entry) => {
      if (entry.entryType === 'mark') performance.clearMarks(entry.name);
      else if (entry.entryType === 'measure') performance.clearMeasures(entry.name);
    });
}

export function clearTopicPerf(): void {
  history.length = 0;
  activeEntries.clear();
  activeActivationByRoute.clear();
  routeObservations.clear();
  currentRouteKey = null;
  requestHistory.length = 0;
  try {
    performance
      .getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith(`${MARK_PREFIX}:`))
      .forEach((entry) => performance.clearMarks(entry.name));
    performance
      .getEntriesByType('measure')
      .filter((entry) => entry.name.startsWith(`${MARK_PREFIX}:`))
      .forEach((entry) => performance.clearMeasures(entry.name));
  } catch {
    // Ignore environments without the full Performance API.
  }
}

exposeDebugApi();
