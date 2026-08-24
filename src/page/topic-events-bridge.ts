/* Linux.do 工具箱 - MAIN world Discourse MessageBus 事件桥 */

import {
  HISTORY_NAVIGATION_EVENT_NAME,
  PAGE_NAVIGATION_EVENT_NAME,
  parseTopicRoute,
} from '../common/topic-route';
import {
  parseTopicEventDetail,
  sanitizeTopicMessage,
  TOPIC_EVENT_NAME,
  type TopicEventDetail,
} from '../content/topic-events';
import {
  parseTopicActionRequest,
  parseTopicInteractionRequest,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
  TOPIC_INTERACTION_REQUEST_NAME,
  TOPIC_INTERACTION_RESULT_NAME,
  type TopicActionRequest,
  type TopicActionResult,
  type TopicInteractionRequest,
  type TopicInteractionResult,
  type TopicInteractionUser,
  type TopicReactionOption,
} from '../content/topic-actions';
import { TOPIC_CODE_HIGHLIGHT_REQUEST_NAME } from '../content/topic-code-blocks';

const MAX_DISCOVERY_ATTEMPTS = 40;

type MessageCallback = (data: unknown) => void;

interface MessageBusCallbackRecord {
  channel?: string;
  last_id?: number;
}

interface MessageBusClient {
  callbacks?: MessageBusCallbackRecord[];
  subscribe: (channel: string, callback: MessageCallback, lastId?: number) => void;
  unsubscribe: (channel: string, callback: MessageCallback) => void;
}

interface PluginApi {
  onPageChange: (callback: () => void) => void;
  onAppEvent?: (name: string, callback: (value: unknown) => void) => void;
  container?: DiscourseContainer;
}

interface PluginApiModule {
  withPluginApi: (version: string, callback: (api: PluginApi) => void) => void;
}

interface PageWindow extends Window {
  MessageBus?: MessageBusClient;
  require?: (moduleName: string) => unknown;
  __ldtkHistoryNavigationHookInstalled?: boolean;
  Discourse?: {
    __container__?: DiscourseContainer;
  };
}

interface DiscourseTextModule {
  emojiUrlFor?: (code: string) => string | undefined;
}

interface DiscourseAjaxModule {
  ajax?: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
}

interface HighlightSyntaxModule {
  default?: (element: HTMLElement, siteSettings: object, session: object) => Promise<void> | void;
}

interface DiscourseContainer {
  lookup: (name: string) => unknown;
  isDestroying?: boolean;
  isDestroyed?: boolean;
}

interface TopicPostStream {
  findLoadedPost?: (postId: number) => unknown;
  loadPost?: (postId: number) => Promise<unknown>;
}

interface TopicController {
  get?: (property: string) => unknown;
  model?: unknown;
  composer?: unknown;
  replyToPost?: (post: unknown) => unknown;
  toggleBookmark?: (post: unknown) => unknown;
  editPost?: (post: unknown) => unknown;
  deletePost?: (post: unknown, options?: Record<string, unknown>) => unknown;
  deletePostWithConfirmation?: (post: unknown, options?: Record<string, unknown>) => unknown;
  recoverPost?: (post: unknown) => unknown;
  showPostFlags?: (post: unknown) => unknown;
  send?: (action: string, ...args: unknown[]) => unknown;
}

interface ComposerService {
  open?: (options: Record<string, unknown>) => unknown;
}

type TopicTargetRequest = Pick<
  TopicActionRequest | TopicInteractionRequest,
  'topicId' | 'postId' | 'floor' | 'routeUrl'
>;

const pageWindow = window as PageWindow;
let activeChannel: string | null = null;
let activeCallback: MessageCallback | null = null;
let pluginHookInstalled = false;
let discourseContainer: DiscourseContainer | null = null;
let codeHighlightRetry: number | null = null;

function retryCodeHighlight(attempt: number): void {
  if (attempt >= MAX_DISCOVERY_ATTEMPTS || codeHighlightRetry !== null) return;
  codeHighlightRetry = window.setTimeout(() => highlightSplitCodeBlocks(attempt + 1), 250);
}

function getTopicId(): number | null {
  const route = parseTopicRoute(window.location.pathname);
  return route ? Number(route.topicId) : null;
}

function dispatchActionResult(
  target: Element,
  request: TopicActionRequest,
  result: Omit<TopicActionResult, 'requestId'>,
): void {
  target.dispatchEvent(
    new CustomEvent(TOPIC_ACTION_RESULT_NAME, {
      detail: JSON.stringify({ requestId: request.requestId, ...result }),
    }),
  );
}

function dispatchInteractionResult(
  target: Element,
  request: TopicInteractionRequest,
  result: Omit<TopicInteractionResult, 'requestId' | 'interaction'>,
): void {
  target.dispatchEvent(
    new CustomEvent(TOPIC_INTERACTION_RESULT_NAME, {
      detail: JSON.stringify({
        requestId: request.requestId,
        interaction: request.interaction,
        ...result,
      }),
    }),
  );
}

function validateActionRoute(request: TopicTargetRequest): boolean {
  try {
    const url = new URL(request.routeUrl, window.location.origin);
    if (url.origin !== window.location.origin) return false;
    const route = parseTopicRoute(url.pathname);
    return Number(route?.topicId) === request.topicId;
  } catch {
    return false;
  }
}

function readProperty(value: unknown, property: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const object = value as Record<string, unknown> & { get?: (key: string) => unknown };
  return typeof object.get === 'function' ? object.get(property) : object[property];
}

function isUsableContainer(value: unknown): value is DiscourseContainer {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as DiscourseContainer).lookup === 'function' &&
    (value as DiscourseContainer).isDestroying !== true &&
    (value as DiscourseContainer).isDestroyed !== true
  );
}

function getDiscourseContainer(): DiscourseContainer | null {
  if (isUsableContainer(discourseContainer)) return discourseContainer;

  const legacyContainer = pageWindow.Discourse?.__container__;
  if (isUsableContainer(legacyContainer)) {
    discourseContainer = legacyContainer;
    return legacyContainer;
  }

  try {
    const module = pageWindow.require?.('discourse/lib/plugin-api') as PluginApiModule | undefined;
    module?.withPluginApi('1.0.0', (api) => {
      if (isUsableContainer(api.container)) discourseContainer = api.container;
    });
  } catch {
    discourseContainer = null;
  }
  return isUsableContainer(discourseContainer) ? discourseContainer : null;
}

function lookupDiscourse(name: string): unknown {
  try {
    return getDiscourseContainer()?.lookup(name);
  } catch {
    discourseContainer = null;
    return undefined;
  }
}

function highlightSplitCodeBlocks(attempt = 0): void {
  if (codeHighlightRetry !== null) {
    window.clearTimeout(codeHighlightRetry);
    codeHighlightRetry = null;
  }
  const cookedContainers = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.ldtk-topic-reading-root .cooked:not([data-ldtk-highlight-processed])',
    ),
  ).filter((cooked) => cooked.querySelector('pre.codeblock-buttons > code'));
  if (cookedContainers.length === 0) return;

  try {
    const module = pageWindow.require?.('discourse/lib/highlight-syntax') as
      HighlightSyntaxModule | undefined;
    const siteSettings = lookupDiscourse('service:site-settings');
    const session = lookupDiscourse('service:session');
    if (
      !module?.default ||
      !siteSettings ||
      typeof siteSettings !== 'object' ||
      !session ||
      typeof session !== 'object'
    ) {
      retryCodeHighlight(attempt);
      return;
    }

    cookedContainers.forEach((cooked) => {
      cooked.dataset.ldtkHighlightProcessed = 'true';
      try {
        void Promise.resolve(module.default?.(cooked, siteSettings, session)).catch(() => {
          delete cooked.dataset.ldtkHighlightProcessed;
          retryCodeHighlight(attempt);
        });
      } catch {
        delete cooked.dataset.ldtkHighlightProcessed;
        retryCodeHighlight(attempt);
      }
    });
  } catch {
    retryCodeHighlight(attempt);
  }
}

function isReplyComposerOpen(): boolean {
  return (
    document.getElementById('reply-control')?.classList.contains('open') === true ||
    document.documentElement.classList.contains('composer-open')
  );
}

function focusReplyComposer(): void {
  window.requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(
        '#reply-control.open .d-editor-input, #reply-control.open textarea, #reply-control.open [contenteditable="true"]',
      )
      ?.focus();
  });
}

function waitForReplyComposer(timeoutMs: number): Promise<boolean> {
  if (isReplyComposerOpen()) {
    focusReplyComposer();
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeout = 0;
    const finish = (opened: boolean): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      if (opened) focusReplyComposer();
      resolve(opened);
    };
    const observer = new MutationObserver(() => {
      if (isReplyComposerOpen()) finish(true);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class'],
    });
    timeout = window.setTimeout(() => finish(false), timeoutMs);
  });
}

async function openReplyWithController(request: TopicActionRequest): Promise<boolean> {
  const candidate = lookupDiscourse('controller:topic');
  if (!candidate || typeof candidate !== 'object') return false;
  const controller = candidate as TopicController;

  const model = readProperty(controller, 'model');
  const postStream = readProperty(model, 'postStream') as TopicPostStream | undefined;
  if (!postStream) return false;

  try {
    let post = postStream.findLoadedPost?.(request.postId);
    if (!post && postStream.loadPost) post = await postStream.loadPost(request.postId);
    if (!post) return false;

    if (typeof controller.replyToPost === 'function') {
      await controller.replyToPost.call(controller, post);
      if (await waitForReplyComposer(750)) return true;
    }

    const topic = readProperty(post, 'topic') || model;
    const details = readProperty(topic, 'details');
    if (readProperty(details, 'can_create_post') === false) return false;
    const draftKey = readProperty(topic, 'draft_key');
    const draftSequence = readProperty(topic, 'draft_sequence');
    const composerCandidate =
      readProperty(controller, 'composer') || lookupDiscourse('service:composer');
    if (
      typeof draftKey !== 'string' ||
      !composerCandidate ||
      typeof composerCandidate !== 'object'
    ) {
      return false;
    }
    const composer = composerCandidate as ComposerService;
    if (typeof composer.open !== 'function') return false;
    await composer.open.call(composer, {
      action: 'reply',
      draftKey,
      draftSequence: typeof draftSequence === 'number' ? draftSequence : 0,
      ...(request.floor === 1 ? { topic } : { post }),
    });
    return await waitForReplyComposer(2_500);
  } catch {
    return false;
  }
}

interface LoadedActionPost {
  controller: TopicController;
  post: unknown;
}

function getTopicController(): TopicController | null {
  const candidate = lookupDiscourse('controller:topic');
  return candidate && typeof candidate === 'object' ? (candidate as TopicController) : null;
}

async function loadActionPost(request: TopicActionRequest): Promise<LoadedActionPost> {
  const controller = getTopicController();
  if (!controller) throw new Error('Discourse 主题控制器尚未就绪');
  const model = readProperty(controller, 'model');
  const modelTopicId = Number(readProperty(model, 'id'));
  if (Number.isInteger(modelTopicId) && modelTopicId !== request.topicId) {
    throw new Error('当前主题状态已经变化，请重试');
  }
  const postStream = readProperty(model, 'postStream') as TopicPostStream | undefined;
  if (!postStream) throw new Error('Discourse 帖子流尚未就绪');
  let post = postStream.findLoadedPost?.(request.postId);
  if (!post && postStream.loadPost) post = await postStream.loadPost(request.postId);
  if (!post) throw new Error('无法静默加载当前楼层');
  return { controller, post };
}

function getErrorMessage(error: unknown): string {
  const responseJSON = readProperty(error, 'responseJSON');
  const errors = readProperty(responseJSON, 'errors');
  if (Array.isArray(errors) && typeof errors[0] === 'string') return errors[0];
  const message = readProperty(error, 'message');
  return typeof message === 'string' && message.trim() ? message : '操作失败，请重试';
}

async function submitBoost(request: TopicActionRequest): Promise<void> {
  const raw = request.boostRaw?.trim();
  if (!raw) throw new Error('请输入助推内容');
  const module = pageWindow.require?.('discourse/lib/ajax') as DiscourseAjaxModule | undefined;
  if (typeof module?.ajax !== 'function') throw new Error('Discourse 请求服务尚未就绪');
  await module.ajax(`/discourse-boosts/posts/${request.postId}/boosts`, {
    type: 'POST',
    data: { raw },
  });
}

function getAjax(): NonNullable<DiscourseAjaxModule['ajax']> {
  const module = pageWindow.require?.('discourse/lib/ajax') as DiscourseAjaxModule | undefined;
  if (typeof module?.ajax !== 'function') throw new Error('Discourse 请求服务尚未就绪');
  return module.ajax;
}

function getReactionUrl(reactionId: string): string | undefined {
  try {
    const textModule = pageWindow.require?.('discourse/lib/text') as
      DiscourseTextModule | undefined;
    return textModule?.emojiUrlFor?.(reactionId);
  } catch {
    return undefined;
  }
}

function dispatchReactionState(postId: number, value: unknown): void {
  const topicId = getTopicId();
  if (!topicId) return;
  const reaction = readProperty(value, 'current_user_reaction');
  const reactionIdValue = readProperty(reaction, 'id');
  const currentReactionId =
    typeof reactionIdValue === 'string' && reactionIdValue.length > 0 ? reactionIdValue : null;
  const currentReactionUrl = currentReactionId ? getReactionUrl(currentReactionId) : undefined;
  const detail = parseTopicEventDetail({
    topicId,
    postId,
    type: 'acted',
    currentReactionId,
    ...(currentReactionUrl ? { currentReactionUrl } : {}),
  });
  if (detail) dispatchTopicEvent(detail);
}

async function toggleReaction(request: TopicActionRequest): Promise<void> {
  const reactionId = request.reactionId;
  if (!reactionId) throw new Error('请选择表态');
  await getAjax()(
    `/discourse-reactions/posts/${request.postId}/custom-reactions/${encodeURIComponent(reactionId)}/toggle.json`,
    { type: 'PUT' },
  );
}

interface SharedIssueActionResult {
  sharedIssueCount: number;
  userCreatedSharedIssue: boolean;
}

async function toggleSharedIssue(request: TopicActionRequest): Promise<SharedIssueActionResult> {
  const result = await getAjax()('/solution/shared_issue', {
    type: 'POST',
    data: { topic_id: request.topicId },
  });
  const count = Number(readProperty(result, 'count'));
  const userCreatedSharedIssue = readProperty(result, 'user_created_shared_issue');
  if (!Number.isInteger(count) || count < 0 || typeof userCreatedSharedIssue !== 'boolean') {
    throw new Error('相同问题状态响应无效');
  }
  return { sharedIssueCount: count, userCreatedSharedIssue };
}

async function executeModelAction(
  request: TopicActionRequest,
): Promise<SharedIssueActionResult | void> {
  if (request.action === 'sharedIssue') return toggleSharedIssue(request);
  if (request.action === 'boost') {
    await submitBoost(request);
    return;
  }
  if (request.action === 'reply') {
    if (!(await openReplyWithController(request))) throw new Error('无法静默打开回复编辑器');
    return;
  }
  if (request.action === 'reaction') {
    await toggleReaction(request);
    return;
  }
  const { controller, post } = await loadActionPost(request);
  if (request.action === 'like') {
    const likeAction = readProperty(post, 'likeAction');
    const togglePromise = readProperty(likeAction, 'togglePromise');
    if (typeof togglePromise !== 'function') throw new Error('当前楼层不能点赞');
    await togglePromise.call(likeAction, post);
    return;
  }
  if (request.action === 'bookmark' && typeof controller.toggleBookmark === 'function') {
    await controller.toggleBookmark.call(controller, post);
    return;
  }
  if (request.action === 'edit' && typeof controller.editPost === 'function') {
    await controller.editPost.call(controller, post);
    return;
  }
  if (request.action === 'delete') {
    if (typeof controller.deletePostWithConfirmation === 'function') {
      await controller.deletePostWithConfirmation.call(controller, post);
      return;
    }
    if (typeof controller.deletePost === 'function') {
      await controller.deletePost.call(controller, post);
      return;
    }
  }
  if (request.action === 'recover' && typeof controller.recoverPost === 'function') {
    await controller.recoverPost.call(controller, post);
    return;
  }
  if (request.action === 'flag') {
    if (typeof controller.showPostFlags === 'function') {
      await controller.showPostFlags.call(controller, post);
      return;
    }
    if (typeof controller.send === 'function') {
      await controller.send.call(controller, 'showFlags', post);
      return;
    }
  }
  throw new Error('当前操作没有可用的静默接口');
}

function readInteractionUser(value: unknown): TopicInteractionUser | null {
  const username = readProperty(value, 'username');
  if (typeof username !== 'string' || !username) return null;
  const idValue = Number(readProperty(value, 'id'));
  const name = readProperty(value, 'name');
  const avatarTemplate = readProperty(value, 'avatar_template');
  return {
    ...(Number.isInteger(idValue) && idValue > 0 ? { id: idValue } : {}),
    username,
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof avatarTemplate === 'string' ? { avatarTemplate } : {}),
  };
}

async function getLikeUsers(request: TopicInteractionRequest): Promise<{
  users: TopicInteractionUser[];
  total: number;
  hasMore: boolean;
}> {
  const page = request.page ?? 0;
  const pageSize = request.pageSize ?? 30;
  const result = await getAjax()('/post_action_users', {
    data: {
      id: request.postId,
      post_action_type_id: 2,
      page,
      limit: pageSize,
    },
  });
  const values = readProperty(result, 'post_action_users');
  const users = Array.isArray(values)
    ? values.flatMap((value) => {
        const user = readInteractionUser(value);
        return user ? [user] : [];
      })
    : [];
  const totalValue = Number(readProperty(result, 'total_rows_post_action_users'));
  const total = Number.isInteger(totalValue) && totalValue >= 0 ? totalValue : users.length;
  const hasMore = users.length >= pageSize && total > (page + 1) * pageSize;
  return { users, total, hasMore };
}

function getReactionOptions(): TopicReactionOption[] {
  const settings = lookupDiscourse('service:site-settings');
  const enabledValue = readProperty(settings, 'discourse_reactions_enabled_reactions');
  const mainValue = readProperty(settings, 'discourse_reactions_reaction_for_like');
  if (typeof enabledValue !== 'string' || typeof mainValue !== 'string' || !mainValue) {
    throw new Error('表态设置尚未就绪');
  }
  const ids = enabledValue.split('|').filter(Boolean);
  if (!ids.includes(mainValue)) ids.unshift(mainValue);
  const options = [...new Set(ids)].flatMap((id) => {
    const url = getReactionUrl(id);
    return url ? [{ id, url, isMain: id === mainValue }] : [];
  });
  if (options.length === 0) throw new Error('没有可用的表态');
  return options;
}

async function executeInteraction(
  request: TopicInteractionRequest,
): Promise<TopicInteractionResult> {
  if (request.interaction === 'reactionOptions') {
    return {
      requestId: request.requestId,
      interaction: request.interaction,
      ok: true,
      reactionOptions: getReactionOptions(),
    };
  }
  const result = await getLikeUsers(request);
  return {
    requestId: request.requestId,
    interaction: request.interaction,
    ok: true,
    ...result,
  };
}

function handleActionRequest(event: Event): void {
  if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
  const request = parseTopicActionRequest(event.detail);
  if (!request || request.topicId !== getTopicId()) return;
  if (!validateActionRoute(request)) return;
  const target = event.target;
  void executeModelAction(request)
    .then((result) =>
      dispatchActionResult(target, request, {
        ok: true,
        phase: 'settled',
        ...(result || {}),
      }),
    )
    .catch((error: unknown) => {
      dispatchActionResult(target, request, {
        ok: false,
        phase: 'settled',
        message: getErrorMessage(error),
      });
    });
}

function handleInteractionRequest(event: Event): void {
  if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
  const request = parseTopicInteractionRequest(event.detail);
  if (!request || request.topicId !== getTopicId()) return;
  if (!validateActionRoute(request)) return;
  const target = event.target;
  void executeInteraction(request)
    .then((result) => dispatchInteractionResult(target, request, result))
    .catch((error: unknown) => {
      dispatchInteractionResult(target, request, {
        ok: false,
        message: getErrorMessage(error),
      });
    });
}

function forwardEvent(topicId: number, value: unknown): void {
  const detail = sanitizeTopicMessage(topicId, value);
  if (!detail) return;
  dispatchTopicEvent(detail);
}

function dispatchTopicEvent(detail: TopicEventDetail): void {
  document.dispatchEvent(
    new CustomEvent(TOPIC_EVENT_NAME, {
      detail: JSON.stringify(detail),
    }),
  );
}

function forwardReactionToggle(value: unknown): void {
  const topicId = getTopicId();
  const post = readProperty(value, 'post');
  const postId = Number(readProperty(post, 'id'));
  if (!topicId || !Number.isInteger(postId) || postId <= 0) return;

  dispatchReactionState(postId, post);
}

function unsubscribe(): void {
  if (!activeChannel || !activeCallback || !pageWindow.MessageBus) return;
  pageWindow.MessageBus.unsubscribe(activeChannel, activeCallback);
  activeChannel = null;
  activeCallback = null;
}

function subscribeToCurrentTopic(): boolean {
  const messageBus = pageWindow.MessageBus;
  if (!messageBus) return false;
  const topicId = getTopicId();
  const channel = topicId ? `/topic/${topicId}` : null;
  if (channel === activeChannel) return true;
  unsubscribe();
  if (!topicId || !channel) return true;

  const callback: MessageCallback = (data) => forwardEvent(topicId, data);
  const existingCursor = messageBus.callbacks?.find((item) => item.channel === channel)?.last_id;
  if (typeof existingCursor === 'number') messageBus.subscribe(channel, callback, existingCursor);
  else messageBus.subscribe(channel, callback);
  activeChannel = channel;
  activeCallback = callback;
  return true;
}

function dispatchPageNavigation(): void {
  subscribeToCurrentTopic();
  document.dispatchEvent(new Event(PAGE_NAVIGATION_EVENT_NAME));
}

function dispatchHistoryNavigation(): void {
  subscribeToCurrentTopic();
  document.dispatchEvent(new Event(HISTORY_NAVIGATION_EVENT_NAME));
}

function installHistoryNavigationHook(): void {
  if (pageWindow.__ldtkHistoryNavigationHookInstalled) return;
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => {
    pushState(data, unused, url);
    dispatchHistoryNavigation();
  };
  history.replaceState = (data, unused, url) => {
    replaceState(data, unused, url);
    dispatchHistoryNavigation();
  };
  pageWindow.__ldtkHistoryNavigationHookInstalled = true;
}

function installPluginHook(): boolean {
  if (pluginHookInstalled || !pageWindow.require) return pluginHookInstalled;
  try {
    const module = pageWindow.require('discourse/lib/plugin-api') as PluginApiModule | undefined;
    if (!module?.withPluginApi) return false;
    module.withPluginApi('1.0.0', (api) => {
      discourseContainer = api.container || null;
      api.onPageChange(dispatchPageNavigation);
      api.onAppEvent?.('discourse-reactions:reaction-toggled', forwardReactionToggle);
      subscribeToCurrentTopic();
    });
    pluginHookInstalled = true;
    return true;
  } catch {
    return false;
  }
}

function discover(attempt = 0): void {
  const busReady = subscribeToCurrentTopic();
  const hookReady = installPluginHook();
  if ((busReady && hookReady) || attempt >= MAX_DISCOVERY_ATTEMPTS) return;
  window.setTimeout(() => discover(attempt + 1), 250);
}

installHistoryNavigationHook();
window.addEventListener('popstate', dispatchHistoryNavigation);
document.addEventListener('DOMContentLoaded', () => subscribeToCurrentTopic(), { once: true });
document.addEventListener(TOPIC_ACTION_REQUEST_NAME, handleActionRequest);
document.addEventListener(TOPIC_INTERACTION_REQUEST_NAME, handleInteractionRequest);
document.addEventListener(TOPIC_CODE_HIGHLIGHT_REQUEST_NAME, () => highlightSplitCodeBlocks());
discover();
