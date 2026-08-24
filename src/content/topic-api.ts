/* Linux.do 工具箱 - Discourse 主题 JSON 客户端 */

import { getTopicIdentityKey, type TopicRoute } from '../common/topic-route';
import { parseRetryAfter, RateLimitError } from './api-rate-limiter';
import { recordTopicRequest, type TopicRequestKind } from './topic-perf';

const MEGA_TOPIC_POST_LIMIT = 10_000;
const POST_BATCH_SIZE = 20;
const POST_FETCH_CONCURRENCY = 2;
const POST_FETCH_MAX_RETRIES = 2;
const MAX_AUTOMATIC_BACKOFF_MS = 10_000;
const TOPIC_PREFETCH_TTL_MS = 15_000;

export interface TopicPostAction {
  id: number;
  count?: number;
  can_act?: boolean;
  acted?: boolean;
}

export interface TopicPostReaction {
  id: string;
  type?: string;
  count: number;
  emoji_url?: string;
  users?: TopicParticipant[];
}

export interface TopicParticipant {
  id?: number;
  username: string;
  name?: string | null;
  avatar_template?: string;
  post_count?: number;
  primary_group_name?: string | null;
}

export interface TopicLink {
  url?: string;
  title?: string;
  clicks?: number;
  internal?: boolean;
  attachment?: boolean;
}

export interface TopicBoost {
  id: number;
  cooked: string;
  can_delete?: boolean;
  can_flag?: boolean;
  user?: TopicParticipant | null;
}

export interface TopicPostCurrentReaction {
  id: string;
  type?: string;
  can_undo?: boolean;
}

export interface TopicAcceptedAnswer {
  id: number;
  topic_id: number;
  post_number: number;
  username: string;
  name?: string;
  avatar_template?: string;
  created_at: string;
  cooked?: string;
  url?: string;
  accepter_name?: string;
  accepter_username?: string;
}

export interface TopicPost {
  id: number;
  topic_id: number;
  post_number: number;
  username: string;
  name?: string;
  display_username?: string;
  avatar_template?: string;
  created_at: string;
  updated_at?: string;
  cooked: string;
  reply_to_post_number?: number | null;
  reply_count?: number;
  yours?: boolean;
  actions_summary?: TopicPostAction[];
  reactions?: TopicPostReaction[];
  reaction_users_count?: number;
  current_user_reaction?: TopicPostCurrentReaction | null;
  current_user_used_main_reaction?: boolean;
  boosts?: TopicBoost[];
  can_boost?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  can_recover?: boolean;
  bookmarked?: boolean;
  bookmark_id?: number | null;
  bookmark_reminder_at?: string | null;
  hidden?: boolean;
  deleted_at?: string | null;
  user_title?: string | null;
  primary_group_name?: string | null;
}

export interface TopicResponse {
  id: number;
  title: string;
  fancy_title?: string;
  slug?: string;
  closed?: boolean;
  archived?: boolean;
  posts_count: number;
  highest_post_number?: number;
  last_read_post_number?: number;
  views?: number;
  reply_count?: number;
  like_count?: number;
  participant_count?: number;
  word_count?: number;
  accepted_answers?: TopicAcceptedAnswer[];
  has_accepted_answer?: boolean;
  shared_issue_count?: number;
  user_created_shared_issue?: boolean;
  can_create_shared_issue?: boolean;
  shared_issue_visible?: boolean;
  details?: {
    can_create_post?: boolean;
    participants?: TopicParticipant[];
    links?: TopicLink[];
  };
  post_stream: {
    posts: TopicPost[];
    stream: number[];
  };
}

export interface InitialCommentBatch {
  pageOffset: number;
  posts: TopicPost[];
}

export interface InitialCommentBatchError {
  pageOffsets: readonly number[];
  error: Error;
  retryAt?: number;
}

export interface InitialLoadHooks {
  onArticle?: (article: TopicPost) => void;
  onCommentBatch?: (batch: InitialCommentBatch) => void;
  onCommentBatchError?: (failure: InitialCommentBatchError) => void;
  onCommentsReady?: (failedPageOffsets: readonly number[]) => void;
  onReplyTargets?: (postIds: readonly number[]) => void;
}

export interface InitialLoadResult {
  posts: TopicPost[];
  failedPageOffsets: number[];
}

interface PostsResponse {
  post_stream?: {
    posts?: TopicPost[];
  };
}

interface PrefetchEntry {
  promise: Promise<TopicResponse>;
  controller: AbortController;
  createdAt: number;
  state: 'pending' | 'fulfilled' | 'rejected';
  consumers: number;
  expired: boolean;
  expiryTimer: number;
  source: 'prefetch' | 'activation';
}

interface PostsBatchItem {
  id: number;
  commentOffset: number;
  article: boolean;
}

interface PostsBatch {
  ids: number[];
  items: PostsBatchItem[];
  containsArticle: boolean;
}

interface BatchFailure {
  batch: PostsBatch;
  error: Error;
}

const topicPrefetches = new Map<string, PrefetchEntry>();
const topicCooldownUntil = new Map<string, number>();

function assertOk(response: Response): Response {
  if (response.status === 429) {
    throw new RateLimitError(parseRetryAfter(response.headers.get('Retry-After')));
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isTopicPost(value: unknown): value is TopicPost {
  if (!value || typeof value !== 'object') return false;
  const post = value as Partial<TopicPost>;
  return (
    isFinitePositiveInteger(post.id) &&
    isFinitePositiveInteger(post.topic_id) &&
    isFinitePositiveInteger(post.post_number) &&
    typeof post.username === 'string' &&
    typeof post.created_at === 'string' &&
    typeof post.cooked === 'string'
  );
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isAbortError(value: unknown): boolean {
  return Boolean(
    value && typeof value === 'object' && 'name' in value && value.name === 'AbortError',
  );
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    const handleAbort = (): void => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

async function waitForSharedCooldown(topicId: string, signal?: AbortSignal): Promise<void> {
  const cooldownUntil = topicCooldownUntil.get(topicId) || 0;
  const waitMs = cooldownUntil - Date.now();
  if (waitMs > 0) await abortableDelay(waitMs, signal);
  else if (cooldownUntil > 0) topicCooldownUntil.delete(topicId);
}

function routeForTopic(topicId: string, floor?: number): TopicRoute {
  return floor === undefined ? { topicId } : { topicId, floor };
}

function keyForRoute(route: TopicRoute): string {
  return getTopicIdentityKey(route) || route.topicId;
}

function isPrefetchUsable(entry: PrefetchEntry): boolean {
  if (Date.now() - entry.createdAt >= TOPIC_PREFETCH_TTL_MS) entry.expired = true;
  return !entry.expired && entry.state !== 'rejected';
}

async function withConsumerAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const handleAbort = (): void => reject(abortError());
    signal.addEventListener('abort', handleAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', handleAbort);
    });
  });
}

export function parseTopicResponse(value: unknown): TopicResponse {
  if (!value || typeof value !== 'object') throw new Error('主题数据格式无效');
  const topic = value as Partial<TopicResponse>;
  const stream = topic.post_stream?.stream;
  const posts = topic.post_stream?.posts;
  if (
    !isFinitePositiveInteger(topic.id) ||
    typeof topic.title !== 'string' ||
    typeof topic.posts_count !== 'number' ||
    !Array.isArray(stream) ||
    !stream.every(isFinitePositiveInteger) ||
    !Array.isArray(posts) ||
    !posts.every(isTopicPost)
  ) {
    throw new Error('主题数据格式无效');
  }
  return topic as TopicResponse;
}

async function requestTopic(
  route: TopicRoute,
  signal: AbortSignal | undefined,
  source: 'prefetch' | 'activation',
): Promise<TopicResponse> {
  return recordTopicRequest(route, 'topic', source, async () => {
    const response = await fetch(
      `/t/${encodeURIComponent(route.topicId)}.json?track_visit=true&forceLoad=true`,
      {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal,
      },
    );
    const value = parseTopicResponse(await assertOk(response).json());
    return { value, status: response.status };
  });
}

function expirePrefetchEntry(key: string, entry: PrefetchEntry): void {
  entry.expired = true;
  if (entry.consumers > 0) return;
  entry.controller.abort();
  if (topicPrefetches.get(key) === entry) topicPrefetches.delete(key);
}

function createPrefetchEntry(
  route: TopicRoute,
  key: string,
  source: PrefetchEntry['source'] = 'prefetch',
): PrefetchEntry {
  const controller = new AbortController();
  const entry: PrefetchEntry = {
    promise: Promise.resolve(null as unknown as TopicResponse),
    controller,
    createdAt: Date.now(),
    state: 'pending',
    consumers: 0,
    expired: false,
    expiryTimer: 0,
    source,
  };
  entry.promise = requestTopic(route, controller.signal, source).then(
    (topic) => {
      entry.state = 'fulfilled';
      return topic;
    },
    (error: unknown) => {
      entry.state = 'rejected';
      throw error;
    },
  );
  void entry.promise.catch(() => undefined);
  entry.expiryTimer = window.setTimeout(
    () => expirePrefetchEntry(key, entry),
    TOPIC_PREFETCH_TTL_MS,
  );
  return entry;
}

export function prefetchTopicResponse(route: TopicRoute): void {
  const key = keyForRoute(route);
  const current = topicPrefetches.get(key);
  if (current && isPrefetchUsable(current)) return;
  if (current && current.consumers === 0) {
    window.clearTimeout(current.expiryTimer);
    current.controller.abort();
  }
  topicPrefetches.set(key, createPrefetchEntry(route, key));
}

export function getTopicResponsePrefetchStatus(route: TopicRoute): 'hit' | 'miss' {
  const entry = topicPrefetches.get(keyForRoute(route));
  return entry && isPrefetchUsable(entry) ? 'hit' : 'miss';
}

export async function acquireTopicResponse(
  route: TopicRoute,
  signal?: AbortSignal,
): Promise<TopicResponse> {
  const key = keyForRoute(route);
  const entry = topicPrefetches.get(key);
  if (!entry || !isPrefetchUsable(entry)) {
    if (entry && entry.consumers === 0) {
      window.clearTimeout(entry.expiryTimer);
      entry.controller.abort();
      topicPrefetches.delete(key);
    }
    return requestTopic(route, signal, 'activation');
  }

  entry.consumers += 1;
  try {
    return await withConsumerAbort(entry.promise, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    window.clearTimeout(entry.expiryTimer);
    if (entry.source === 'prefetch') {
      if (topicPrefetches.get(key) === entry) {
        topicPrefetches.set(key, createPrefetchEntry(route, key, 'activation'));
      }
      return acquireTopicResponse(route, signal);
    }
    if (topicPrefetches.get(key) === entry) topicPrefetches.delete(key);
    throw error;
  } finally {
    entry.consumers -= 1;
    if (entry.expired && entry.consumers === 0) {
      window.clearTimeout(entry.expiryTimer);
      entry.controller.abort();
      if (topicPrefetches.get(key) === entry) topicPrefetches.delete(key);
    }
  }
}

export function pruneTopicResponsePrefetches(keepKeys: readonly string[]): void {
  const keep = new Set(keepKeys);
  topicPrefetches.forEach((entry, key) => {
    if (keep.has(key) && isPrefetchUsable(entry)) return;
    entry.expired = true;
    window.clearTimeout(entry.expiryTimer);
    entry.controller.abort();
    topicPrefetches.delete(key);
  });
}

export function clearTopicResponsePrefetches(): void {
  topicPrefetches.forEach((entry, key) => {
    entry.expired = true;
    window.clearTimeout(entry.expiryTimer);
    entry.controller.abort();
    topicPrefetches.delete(key);
  });
}

export function buildPostsUrl(topicId: string, postIds: readonly number[]): string {
  const params = new URLSearchParams();
  postIds.forEach((postId) => params.append('post_ids[]', String(postId)));
  return `/t/${encodeURIComponent(topicId)}/posts.json?${params.toString()}`;
}

async function requestPosts(
  topicId: string,
  postIds: readonly number[],
  signal: AbortSignal | undefined,
  kind: TopicRequestKind,
  source: 'activation' | 'retry',
  route: TopicRoute = routeForTopic(topicId),
): Promise<TopicPost[]> {
  if (postIds.length === 0) return [];
  return recordTopicRequest(route, kind, source, async () => {
    const response = await fetch(buildPostsUrl(topicId, postIds), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    const payload = (await assertOk(response).json()) as PostsResponse;
    const posts = payload.post_stream?.posts;
    if (!Array.isArray(posts) || !posts.every(isTopicPost)) {
      throw new Error('楼层数据格式无效');
    }
    const byId = new Map(posts.map((post) => [post.id, post]));
    return {
      value: postIds.flatMap((postId) => {
        const post = byId.get(postId);
        return post ? [post] : [];
      }),
      status: response.status,
    };
  });
}

async function fetchPostsWithRetry(
  topicId: string,
  postIds: readonly number[],
  signal?: AbortSignal,
  kind: TopicRequestKind = 'posts',
  route: TopicRoute = routeForTopic(topicId),
): Promise<TopicPost[]> {
  let attempt = 0;
  while (true) {
    await waitForSharedCooldown(topicId, signal);
    try {
      return await requestPosts(
        topicId,
        postIds,
        signal,
        kind,
        attempt === 0 ? 'activation' : 'retry',
        route,
      );
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      const retryAfterMs = Math.max(0, error.retryAfterMs);
      const exponentialMs = 1_000 * 2 ** attempt;
      const waitMs = Math.max(retryAfterMs, exponentialMs);
      topicCooldownUntil.set(
        topicId,
        Math.max(topicCooldownUntil.get(topicId) || 0, Date.now() + waitMs),
      );
      if (
        attempt >= POST_FETCH_MAX_RETRIES ||
        retryAfterMs > MAX_AUTOMATIC_BACKOFF_MS ||
        waitMs > MAX_AUTOMATIC_BACKOFF_MS
      ) {
        throw error;
      }
      attempt += 1;
    }
  }
}

export async function fetchPosts(
  topicId: string,
  postIds: readonly number[],
  signal?: AbortSignal,
): Promise<TopicPost[]> {
  return fetchPostsWithRetry(topicId, postIds, signal);
}

export async function fetchPostReplies(
  postId: number,
  after = 1,
  signal?: AbortSignal,
  topicId?: string,
  floor?: number,
): Promise<TopicPost[]> {
  const params = new URLSearchParams({ after: String(Math.max(1, Math.trunc(after))) });
  const route = routeForTopic(topicId || String(postId), floor);
  return recordTopicRequest(route, 'article-replies', 'activation', async () => {
    const response = await fetch(`/posts/${encodeURIComponent(String(postId))}/replies?${params}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    const replies = (await assertOk(response).json()) as unknown;
    if (!Array.isArray(replies) || !replies.every(isTopicPost)) {
      throw new Error('回复数据格式无效');
    }
    return { value: replies, status: response.status };
  });
}

export class TopicDataSource {
  readonly topic: TopicResponse;
  readonly commentPostIds: readonly number[];
  private articleValue: TopicPost | null;
  private readonly articleCandidateId: number;
  private readonly route: TopicRoute;
  private readonly cache = new Map<number, TopicPost>();
  private readonly cacheByPostNumber = new Map<number, TopicPost>();

  private constructor(topic: TopicResponse, route: TopicRoute) {
    this.topic = topic;
    this.route = route;
    topic.post_stream.posts.forEach((post) => this.cachePost(post));
    this.articleValue = topic.post_stream.posts.find((post) => post.post_number === 1) || null;
    this.articleCandidateId = this.articleValue?.id || topic.post_stream.stream[0] || 0;
    this.commentPostIds = topic.post_stream.stream.filter(
      (postId) => postId !== this.articleCandidateId,
    );
  }

  static async create(
    topicId: string,
    signal?: AbortSignal,
    floor?: number,
    bypassPrefetch = false,
  ): Promise<TopicDataSource> {
    const route = routeForTopic(topicId, floor);
    const topic = bypassPrefetch
      ? await requestTopic(route, signal, 'activation')
      : await acquireTopicResponse(route, signal);
    return new TopicDataSource(topic, route);
  }

  get article(): TopicPost {
    if (!this.articleValue) throw new Error('主题正文尚未加载');
    return this.articleValue;
  }

  get articleReady(): boolean {
    return this.articleValue !== null;
  }

  get articleIdCandidate(): number {
    return this.articleCandidateId;
  }

  get commentCount(): number {
    return this.commentPostIds.length;
  }

  get isMegaTopic(): boolean {
    return (
      this.topic.posts_count >= MEGA_TOPIC_POST_LIMIT ||
      this.topic.post_stream.stream.length >= MEGA_TOPIC_POST_LIMIT
    );
  }

  getCachedPost(postId: number): TopicPost | undefined {
    return this.cache.get(postId);
  }

  getCachedPostByNumber(postNumber: number): TopicPost | undefined {
    return this.cacheByPostNumber.get(postNumber);
  }

  async loadInitial(
    page: number,
    perPage: number,
    signal?: AbortSignal,
    hooks: InitialLoadHooks = {},
  ): Promise<InitialLoadResult> {
    throwIfAborted(signal);
    const start = (page - 1) * perPage;
    const commentIds = this.commentPostIds.slice(start, start + perPage);
    const items: PostsBatchItem[] = [
      ...(this.articleReady || !this.articleCandidateId
        ? []
        : [{ id: this.articleCandidateId, commentOffset: -1, article: true }]),
      ...commentIds.map((id, commentOffset) => ({ id, commentOffset, article: false })),
    ];
    const requestItems = items.filter((item) => !this.cache.has(item.id));

    const batches = chunk(requestItems, POST_BATCH_SIZE).map<PostsBatch>((items) => ({
      ids: items.map((item) => item.id),
      items,
      containsArticle: items.some((item) => item.article),
    }));
    const failures: BatchFailure[] = [];
    let cursor = 0;

    const emitCommentItems = (commentItems: readonly PostsBatchItem[]): void => {
      const ordered = commentItems
        .filter((item) => item.commentOffset >= 0)
        .sort((left, right) => left.commentOffset - right.commentOffset);
      let group: PostsBatchItem[] = [];
      const emitGroup = (): void => {
        const first = group[0];
        if (!first) return;
        hooks.onCommentBatch?.({
          pageOffset: first.commentOffset,
          posts: group.map((item) => this.cachedOrPlaceholder(item.id, start + item.commentOffset)),
        });
        group = [];
      };
      ordered.forEach((item) => {
        const previous = group[group.length - 1];
        if (previous && item.commentOffset !== previous.commentOffset + 1) emitGroup();
        group.push(item);
      });
      emitGroup();
    };

    emitCommentItems(items.filter((item) => this.cache.has(item.id)));

    const runBatch = async (batch: PostsBatch): Promise<void> => {
      try {
        const posts = await fetchPostsWithRetry(
          String(this.topic.id),
          batch.ids,
          signal,
          'posts',
          this.route,
        );
        throwIfAborted(signal);
        posts.forEach((post) => this.cachePost(post));
        if (!this.articleValue) {
          const article = posts.find((post) => post.post_number === 1);
          if (article) {
            this.articleValue = article;
            hooks.onArticle?.(article);
          }
        }
        emitCommentItems(batch.items);
      } catch (error) {
        if (isAbortError(error)) throw error;
        const failure = { batch, error: asError(error) };
        failures.push(failure);
        const pageOffsets = batch.items.flatMap((item) =>
          item.commentOffset < 0 ? [] : [item.commentOffset],
        );
        if (pageOffsets.length > 0) {
          hooks.onCommentBatchError?.({
            pageOffsets,
            error: failure.error,
            ...(failure.error instanceof RateLimitError
              ? { retryAt: topicCooldownUntil.get(String(this.topic.id)) }
              : {}),
          });
        }
      }
    };

    const worker = async (): Promise<void> => {
      while (cursor < batches.length) {
        const batch = batches[cursor] as PostsBatch;
        cursor += 1;
        await runBatch(batch);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(POST_FETCH_CONCURRENCY, batches.length) }, () => worker()),
    );
    throwIfAborted(signal);

    if (!this.articleValue) {
      const articleFailure = failures.find((failure) => failure.batch.containsArticle);
      throw articleFailure?.error || new Error('未找到主题正文');
    }
    const failedPageOffsets = [
      ...new Set(
        failures.flatMap((failure) =>
          failure.batch.items.flatMap((item) =>
            item.commentOffset < 0 ? [] : [item.commentOffset],
          ),
        ),
      ),
    ].sort((left, right) => left - right);
    hooks.onCommentsReady?.(failedPageOffsets);
    const successfulIds = commentIds.filter((_id, offset) => !failedPageOffsets.includes(offset));
    const replyTargetIds = successfulIds.flatMap((postId) => {
      const targetFloor = this.cache.get(postId)?.reply_to_post_number;
      if (!targetFloor) return [];
      const targetId = this.topic.post_stream.stream[targetFloor - 1];
      return targetId ? [targetId] : [];
    });
    try {
      const loadedTargetIds = await this.loadPosts(
        [...new Set(replyTargetIds)],
        signal,
        'reply-targets',
      );
      throwIfAborted(signal);
      if (loadedTargetIds.length > 0) hooks.onReplyTargets?.(loadedTargetIds);
    } catch (error) {
      if (isAbortError(error)) throw error;
      // Reply target enrichment is best effort and does not block comments.
    }

    return {
      posts: commentIds.flatMap((id, offset) =>
        failedPageOffsets.includes(offset) ? [] : [this.cachedOrPlaceholder(id, start + offset)],
      ),
      failedPageOffsets,
    };
  }

  async loadPage(page: number, perPage: number, signal?: AbortSignal): Promise<TopicPost[]> {
    const start = (page - 1) * perPage;
    const ids = this.commentPostIds.slice(start, start + perPage);
    await this.loadPosts(ids, signal);
    const replyTargetIds = ids.flatMap((postId) => {
      const targetFloor = this.cache.get(postId)?.reply_to_post_number;
      if (!targetFloor) return [];
      const targetId = this.topic.post_stream.stream[targetFloor - 1];
      return targetId ? [targetId] : [];
    });
    await this.loadPosts([...new Set(replyTargetIds)], signal, 'reply-targets');
    return ids.map((postId, index) => this.cachedOrPlaceholder(postId, start + index));
  }

  private async loadPosts(
    postIds: readonly number[],
    signal?: AbortSignal,
    kind: TopicRequestKind = 'posts',
  ): Promise<number[]> {
    throwIfAborted(signal);
    const missingIds = postIds.filter((postId) => !this.cache.has(postId));
    const batches = chunk(missingIds, POST_BATCH_SIZE);
    let cursor = 0;
    const loadedIds: number[] = [];
    const worker = async (): Promise<void> => {
      while (cursor < batches.length) {
        const batch = batches[cursor] as number[];
        cursor += 1;
        const posts = await fetchPostsWithRetry(
          String(this.topic.id),
          batch,
          signal,
          kind,
          this.route,
        );
        posts.forEach((post) => {
          this.cachePost(post);
          loadedIds.push(post.id);
        });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(POST_FETCH_CONCURRENCY, batches.length) }, () => worker()),
    );
    throwIfAborted(signal);
    return loadedIds;
  }

  private cachedOrPlaceholder(postId: number, zeroBasedCommentIndex: number): TopicPost {
    return (
      this.cache.get(postId) || {
        id: postId,
        topic_id: this.topic.id,
        post_number: zeroBasedCommentIndex + 2,
        username: 'system',
        created_at: '',
        cooked: '<p>此回复不可见或已删除</p>',
        hidden: true,
      }
    );
  }

  private cachePost(post: TopicPost): void {
    const previous = this.cache.get(post.id);
    if (previous && previous.post_number !== post.post_number) {
      this.cacheByPostNumber.delete(previous.post_number);
    }
    this.cache.set(post.id, post);
    this.cacheByPostNumber.set(post.post_number, post);
  }

  async refreshPost(postId: number, signal?: AbortSignal): Promise<TopicPost | null> {
    const [post] = await fetchPostsWithRetry(
      String(this.topic.id),
      [postId],
      signal,
      'posts',
      this.route,
    );
    if (!post) {
      this.invalidatePost(postId);
      return null;
    }
    this.cachePost(post);
    if (post.post_number === 1) this.articleValue = post;
    return post;
  }

  invalidatePost(postId: number): void {
    const post = this.cache.get(postId);
    if (post) this.cacheByPostNumber.delete(post.post_number);
    this.cache.delete(postId);
  }
}
