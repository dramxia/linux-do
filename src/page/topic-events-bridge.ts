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
  parseTopicReactionPickerRequest,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
  TOPIC_REACTION_PICKER_REQUEST_NAME,
  type TopicAction,
  type TopicActionRequest,
  type TopicActionResult,
  type TopicReactionPickerRequest,
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
  preventCloak?: (postId: number, prevent?: boolean) => void;
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

interface DiscourseUrlModule {
  default?: {
    routeTo?: (url: string) => void;
  };
  routeTo?: (url: string) => void;
}

interface DiscourseTextModule {
  emojiUrlFor?: (code: string) => string | undefined;
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
}

interface ComposerService {
  open?: (options: Record<string, unknown>) => unknown;
}

const ACTION_SELECTORS: Record<TopicAction, readonly string[]> = {
  like: [
    '.discourse-reactions-actions-button-shim .discourse-reactions-reaction-button',
    '.post-action-menu__like',
  ],
  likeUsers: ['.discourse-reactions-counter', '.post-action-menu__like-count'],
  bookmark: ['.post-action-menu__bookmark'],
  boost: ['.post-action-menu__boost', '.discourse-boosts__add-btn'],
  reply: ['.post-action-menu__reply'],
  edit: ['.post-action-menu__edit'],
  delete: ['.post-action-menu__delete'],
  recover: ['.post-action-menu__recover'],
  flag: ['.post-action-menu__flag'],
  share: ['.post-action-menu__share'],
};

const COLLAPSED_ACTIONS = new Set<TopicAction>(['edit', 'delete', 'recover', 'flag', 'share']);
const REACTION_CONTROL_SELECTOR =
  '.discourse-reactions-actions-button-shim .discourse-reactions-reaction-button';

type TopicTargetRequest = Pick<
  TopicActionRequest | TopicReactionPickerRequest,
  'topicId' | 'postId' | 'floor' | 'routeUrl'
>;

const pageWindow = window as PageWindow;
let activeChannel: string | null = null;
let activeCallback: MessageCallback | null = null;
let pluginHookInstalled = false;
let discoursePluginApi: PluginApi | null = null;
let discourseContainer: DiscourseContainer | null = null;
let codeHighlightRetry: number | null = null;
const pendingReactionPickers = new WeakMap<Element, () => void>();

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

function getNativePost(request: TopicTargetRequest): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `#main-outlet article[data-post-id="${request.postId}"], ` +
      `#main-outlet .topic-post[data-post-id="${request.postId}"], ` +
      `#main-outlet .topic-post[data-post-number="${request.floor}"]`,
  );
}

function getNativePostPlaceholder(request: TopicTargetRequest): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `#main-outlet [data-post-number="${request.floor}"], ` +
      `#main-outlet [data-post-id="${request.postId}"]`,
  );
}

function validateActionRoute(request: TopicTargetRequest): URL | null {
  try {
    const url = new URL(request.routeUrl, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const route = parseTopicRoute(url.pathname);
    return Number(route?.topicId) === request.topicId ? url : null;
  } catch {
    return null;
  }
}

function anchorControlToTarget(control: HTMLElement, target: Element): void {
  const original = control.getBoundingClientRect.bind(control);
  control.getBoundingClientRect = () =>
    target.isConnected ? target.getBoundingClientRect() : original();
}

function dispatchReactionPointer(
  control: HTMLElement,
  target: Element,
  type: 'pointerover' | 'pointerout',
): void {
  anchorControlToTarget(control, target);
  const pointerEvent =
    typeof window.PointerEvent === 'function'
      ? new PointerEvent(type, {
          bubbles: true,
          pointerType: 'mouse',
        })
      : new MouseEvent(type, {
          bubbles: true,
        });
  if (!('pointerType' in pointerEvent)) {
    Object.defineProperty(pointerEvent, 'pointerType', { value: 'mouse' });
  }
  control.dispatchEvent(pointerEvent);
}

function queryNativeReactionControl(request: TopicReactionPickerRequest): HTMLElement | null {
  return getNativePost(request)?.querySelector<HTMLElement>(REACTION_CONTROL_SELECTOR) || null;
}

function cancelPendingReactionPicker(target: Element): void {
  pendingReactionPickers.get(target)?.();
  pendingReactionPickers.delete(target);
}

function routeToReactionPicker(
  target: Element,
  request: TopicReactionPickerRequest,
  url: URL,
): void {
  if (!pageWindow.require) return;

  let timeout = 0;
  const cleanup = (): void => {
    observer.disconnect();
    window.clearTimeout(timeout);
    if (pendingReactionPickers.get(target) === cleanup) pendingReactionPickers.delete(target);
  };
  const attemptOpen = (): void => {
    const control = queryNativeReactionControl(request);
    if (!control) return;
    cleanup();
    dispatchReactionPointer(control, target, 'pointerover');
  };
  const observer = new MutationObserver(attemptOpen);
  observer.observe(document.body, { childList: true, subtree: true });
  timeout = window.setTimeout(cleanup, 8_000);
  pendingReactionPickers.set(target, cleanup);

  try {
    const module = pageWindow.require('discourse/lib/url') as DiscourseUrlModule | undefined;
    const routeTo = module?.default?.routeTo || module?.routeTo;
    if (!routeTo) throw new Error('routeTo unavailable');
    routeTo.call(module?.default || module, `${url.pathname}${url.search}${url.hash}`);
    window.setTimeout(attemptOpen, 0);
  } catch {
    cleanup();
  }
}

function handleReactionPickerRequest(event: Event): void {
  if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
  const request = parseTopicReactionPickerRequest(event.detail);
  if (!request || request.topicId !== getTopicId()) return;
  const url = validateActionRoute(request);
  if (!url) return;
  const target = event.target;
  cancelPendingReactionPicker(target);

  const control = queryNativeReactionControl(request);
  if (!request.open) {
    if (control) dispatchReactionPointer(control, target, 'pointerout');
    return;
  }
  if (control) {
    dispatchReactionPointer(control, target, 'pointerover');
  } else {
    routeToReactionPicker(target, request, url);
  }
}

function isMenuExpanded(control: HTMLElement, action: TopicAction): boolean {
  if (action === 'likeUsers' && control.matches('.discourse-reactions-counter')) {
    return Boolean(control.querySelector('.discourse-reactions-state-panel.is-expanded'));
  }
  return control.getAttribute('aria-expanded') === 'true';
}

function watchMenuClose(
  control: HTMLElement,
  target: Element,
  request: TopicActionRequest,
  onClose?: () => void,
): void {
  let expanded = isMenuExpanded(control, request.action);
  let timeout = 0;
  const cleanup = (): void => {
    observer.disconnect();
    window.clearTimeout(timeout);
    onClose?.();
  };
  const observer = new MutationObserver(() => {
    const isExpanded = isMenuExpanded(control, request.action);
    expanded ||= isExpanded;
    if (!expanded || isExpanded) return;
    cleanup();
    dispatchActionResult(target, request, { ok: true, phase: 'settled' });
  });
  observer.observe(control, {
    attributes: true,
    subtree: true,
    attributeFilter: ['aria-expanded', 'class'],
  });
  timeout = window.setTimeout(cleanup, 120_000);
}

function queryNativeControl(post: HTMLElement, action: TopicAction): HTMLElement | null {
  for (const selector of ACTION_SELECTORS[action]) {
    const control = post.querySelector<HTMLElement>(selector);
    if (control) return control;
  }
  return null;
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
      discoursePluginApi = api;
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

function canTriggerNativeAction(post: HTMLElement, action: TopicAction): boolean {
  if (queryNativeControl(post, action)) return true;
  return (
    COLLAPSED_ACTIONS.has(action) &&
    Boolean(post.querySelector<HTMLElement>('.post-action-menu__show-more'))
  );
}

async function findNativeControl(
  post: HTMLElement,
  action: TopicAction,
): Promise<HTMLElement | null> {
  let control = queryNativeControl(post, action);
  if (control || !COLLAPSED_ACTIONS.has(action)) return control;
  post.querySelector<HTMLElement>('.post-action-menu__show-more')?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 50));
  control = queryNativeControl(post, action);
  return control;
}

async function triggerNativeAction(
  post: HTMLElement,
  target: Element,
  request: TopicActionRequest,
  onMenuClose?: () => void,
): Promise<void> {
  const control = await findNativeControl(post, request.action);
  if (!control) {
    onMenuClose?.();
    dispatchActionResult(target, request, {
      ok: false,
      phase: 'triggered',
      message: '当前楼层没有此操作',
    });
    return;
  }
  if (control instanceof HTMLButtonElement && control.disabled) {
    onMenuClose?.();
    dispatchActionResult(target, request, {
      ok: false,
      phase: 'triggered',
      message: '当前操作不可用',
    });
    return;
  }

  anchorControlToTarget(control, target);
  if (
    request.action === 'bookmark' ||
    request.action === 'boost' ||
    request.action === 'likeUsers'
  ) {
    watchMenuClose(control, target, request, onMenuClose);
  } else {
    onMenuClose?.();
  }
  control.click();
  if (request.action === 'reply') {
    const opened = await waitForReplyComposer(3_000);
    dispatchActionResult(target, request, {
      ok: opened,
      phase: 'triggered',
      ...(opened ? {} : { message: '原站回复按钮已触发，但回复面板没有打开' }),
    });
    return;
  }
  dispatchActionResult(target, request, { ok: true, phase: 'triggered' });
}

function exposeBoostControl(target: Element, request: TopicActionRequest): void {
  const placeholder = getNativePostPlaceholder(request);
  const mainOutlet = document.getElementById('main-outlet');
  if (!placeholder || !mainOutlet) {
    dispatchActionResult(target, request, {
      ok: false,
      phase: 'triggered',
      message: '原站楼层尚未加载，请稍后重试',
    });
    return;
  }

  let attempting = false;
  let timeout = 0;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const releasePost = (): void => discoursePluginApi?.preventCloak?.(request.postId, false);
  const cleanup = (): void => {
    observer.disconnect();
    window.clearTimeout(timeout);
    window.scrollTo(scrollX, scrollY);
  };
  const attemptAction = (): void => {
    const post = getNativePost(request);
    if (!post || attempting || !canTriggerNativeAction(post, request.action)) return;
    attempting = true;
    cleanup();
    void triggerNativeAction(post, target, request, releasePost);
  };
  const observer = new MutationObserver(attemptAction);
  observer.observe(mainOutlet, { attributes: true, childList: true, subtree: true });
  timeout = window.setTimeout(() => {
    cleanup();
    releasePost();
    if (!attempting) {
      dispatchActionResult(target, request, {
        ok: false,
        phase: 'triggered',
        message: '原站 Boost 操作栏加载超时，请重试',
      });
    }
  }, 8_000);

  discoursePluginApi?.preventCloak?.(request.postId, true);
  placeholder.scrollIntoView({ block: 'nearest' });
  window.setTimeout(attemptAction, 0);
}

function routeToActionPost(target: Element, request: TopicActionRequest, url: URL): void {
  if (!pageWindow.require) {
    dispatchActionResult(target, request, {
      ok: false,
      phase: 'triggered',
      message: 'Discourse 页面尚未就绪',
    });
    return;
  }

  let attempting = false;
  let timeout = 0;
  const attemptAction = (): void => {
    const post = getNativePost(request);
    if (!post || attempting || !canTriggerNativeAction(post, request.action)) return;
    attempting = true;
    observer.disconnect();
    window.clearTimeout(timeout);
    void triggerNativeAction(post, target, request);
  };
  const observer = new MutationObserver(attemptAction);
  observer.observe(document.body, { childList: true, subtree: true });
  timeout = window.setTimeout(() => {
    observer.disconnect();
    if (!attempting) {
      dispatchActionResult(target, request, {
        ok: false,
        phase: 'triggered',
        message: getNativePost(request) ? '原站操作栏加载超时，请重试' : '原站楼层加载超时，请重试',
      });
    }
  }, 8_000);

  try {
    const module = pageWindow.require('discourse/lib/url') as DiscourseUrlModule | undefined;
    const routeTo = module?.default?.routeTo || module?.routeTo;
    if (!routeTo) throw new Error('routeTo unavailable');
    routeTo.call(module?.default || module, `${url.pathname}${url.search}${url.hash}`);
    window.setTimeout(attemptAction, 0);
  } catch {
    observer.disconnect();
    window.clearTimeout(timeout);
    dispatchActionResult(target, request, {
      ok: false,
      phase: 'triggered',
      message: '无法在后台打开对应楼层',
    });
  }
}

function handleActionRequest(event: Event): void {
  if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
  const request = parseTopicActionRequest(event.detail);
  if (!request || request.topicId !== getTopicId()) return;
  const url = validateActionRoute(request);
  if (!url) return;
  const target = event.target;
  const fallbackToNativeAction = (): void => {
    const post = getNativePost(request);
    if (post && canTriggerNativeAction(post, request.action)) {
      void triggerNativeAction(post, target, request);
    } else if (request.action === 'boost') {
      exposeBoostControl(target, request);
    } else {
      routeToActionPost(target, request, url);
    }
  };
  if (request.action === 'reply') {
    void openReplyWithController(request).then((opened) => {
      if (opened) {
        dispatchActionResult(target, request, { ok: true, phase: 'triggered' });
      } else {
        fallbackToNativeAction();
      }
    });
  } else {
    fallbackToNativeAction();
  }
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

  const reaction = readProperty(value, 'reaction') ?? readProperty(post, 'current_user_reaction');
  const reactionIdValue = readProperty(reaction, 'id');
  const currentReactionId =
    typeof reactionIdValue === 'string' && reactionIdValue.length > 0 ? reactionIdValue : null;
  let currentReactionUrl: string | undefined;
  if (currentReactionId) {
    try {
      const textModule = pageWindow.require?.('discourse/lib/text') as
        DiscourseTextModule | undefined;
      currentReactionUrl = textModule?.emojiUrlFor?.(currentReactionId);
    } catch {
      currentReactionUrl = undefined;
    }
  }

  const detail = parseTopicEventDetail({
    topicId,
    postId,
    type: 'acted',
    currentReactionId,
    ...(currentReactionUrl ? { currentReactionUrl } : {}),
  });
  if (detail) dispatchTopicEvent(detail);
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
      discoursePluginApi = api;
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
document.addEventListener(TOPIC_REACTION_PICKER_REQUEST_NAME, handleReactionPickerRequest);
document.addEventListener(TOPIC_CODE_HIGHLIGHT_REQUEST_NAME, () => highlightSplitCodeBlocks());
discover();
