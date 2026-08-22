"use strict";
(() => {
  // src/content/topic-events.ts
  var TOPIC_EVENT_NAME = "ldtk:topic-event";
  var TOPIC_EVENT_TYPES = [
    "created",
    "revised",
    "rebaked",
    "deleted",
    "destroyed",
    "recovered"
  ];
  function asRecord(value) {
    return value && typeof value === "object" ? value : null;
  }
  function toPositiveInteger(value) {
    const number = typeof value === "string" ? Number(value) : value;
    return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : null;
  }
  function sanitizeTopicMessage(topicId, value) {
    const data = asRecord(value);
    if (!data || typeof data.type !== "string") return null;
    const post = asRecord(data.post);
    const postId = toPositiveInteger(data.post_id) || toPositiveInteger(data.id) || toPositiveInteger(post?.id);
    const eventTopicId = toPositiveInteger(data.topic_id) || toPositiveInteger(post?.topic_id) || topicId;
    if (!postId || eventTopicId !== topicId) return null;
    const updatedAt = typeof data.updated_at === "string" ? data.updated_at : typeof post?.updated_at === "string" ? post.updated_at : void 0;
    return parseTopicEventDetail({
      topicId,
      type: data.type,
      postId,
      ...updatedAt === void 0 ? {} : { updatedAt }
    });
  }
  function parseTopicEventDetail(value) {
    let parsedValue = value;
    if (typeof value === "string") {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (!parsedValue || typeof parsedValue !== "object") return null;
    const detail = parsedValue;
    if (!Number.isInteger(detail.topicId) || Number(detail.topicId) <= 0 || !Number.isInteger(detail.postId) || Number(detail.postId) <= 0 || !TOPIC_EVENT_TYPES.includes(detail.type) || detail.updatedAt !== void 0 && typeof detail.updatedAt !== "string") {
      return null;
    }
    return {
      topicId: detail.topicId,
      type: detail.type,
      postId: detail.postId,
      ...detail.updatedAt === void 0 ? {} : { updatedAt: detail.updatedAt }
    };
  }

  // src/content/topic-actions.ts
  var TOPIC_ACTION_REQUEST_NAME = "ldtk:topic-action-request";
  var TOPIC_ACTION_RESULT_NAME = "ldtk:topic-action-result";
  var TOPIC_ACTIONS = [
    "like",
    "likeUsers",
    "bookmark",
    "reply",
    "edit",
    "delete",
    "recover",
    "flag",
    "share"
  ];
  function parseSerialized(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
  }
  function parseTopicActionRequest(value) {
    const parsed = parseSerialized(value);
    if (!parsed || typeof parsed !== "object") return null;
    const detail = parsed;
    if (typeof detail.requestId !== "string" || !/^[a-zA-Z0-9:_-]{1,100}$/.test(detail.requestId) || !isPositiveInteger(detail.topicId) || !isPositiveInteger(detail.postId) || !isPositiveInteger(detail.floor) || !TOPIC_ACTIONS.includes(detail.action) || typeof detail.routeUrl !== "string" || detail.routeUrl.length === 0 || detail.routeUrl.length > 2048) {
      return null;
    }
    return {
      requestId: detail.requestId,
      topicId: detail.topicId,
      postId: detail.postId,
      floor: detail.floor,
      action: detail.action,
      routeUrl: detail.routeUrl
    };
  }

  // src/page/topic-events-bridge.ts
  var MAX_DISCOVERY_ATTEMPTS = 40;
  var ACTION_SELECTORS = {
    like: [
      ".discourse-reactions-actions-button-shim .discourse-reactions-reaction-button",
      ".post-action-menu__like"
    ],
    likeUsers: [".discourse-reactions-counter", ".post-action-menu__like-count"],
    bookmark: [".post-action-menu__bookmark"],
    reply: [".post-action-menu__reply"],
    edit: [".post-action-menu__edit"],
    delete: [".post-action-menu__delete"],
    recover: [".post-action-menu__recover"],
    flag: [".post-action-menu__flag"],
    share: [".post-action-menu__share"]
  };
  var COLLAPSED_ACTIONS = /* @__PURE__ */ new Set(["edit", "delete", "recover", "flag", "share"]);
  var pageWindow = window;
  var activeChannel = null;
  var activeCallback = null;
  var pluginHookInstalled = false;
  var discourseContainer = null;
  function getTopicId() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts[0] !== "t") return null;
    const value = parts.slice(1).find((part) => /^\d+$/.test(part));
    return value ? Number(value) : null;
  }
  function dispatchActionResult(target, request, result) {
    target.dispatchEvent(
      new CustomEvent(TOPIC_ACTION_RESULT_NAME, {
        detail: JSON.stringify({ requestId: request.requestId, ...result })
      })
    );
  }
  function getNativePost(request) {
    return document.querySelector(
      `#main-outlet .topic-post[data-post-id="${request.postId}"], #main-outlet .topic-post[data-post-number="${request.floor}"]`
    );
  }
  function validateActionRoute(request) {
    try {
      const url = new URL(request.routeUrl, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      const routeTopicId = parts.slice(1).find((part) => /^\d+$/.test(part));
      return parts[0] === "t" && Number(routeTopicId) === request.topicId ? url : null;
    } catch {
      return null;
    }
  }
  function anchorControlToTarget(control, target) {
    const original = control.getBoundingClientRect.bind(control);
    control.getBoundingClientRect = () => target.isConnected ? target.getBoundingClientRect() : original();
  }
  function isMenuExpanded(control, action) {
    if (action === "likeUsers" && control.matches(".discourse-reactions-counter")) {
      return Boolean(control.querySelector(".discourse-reactions-state-panel.is-expanded"));
    }
    return control.getAttribute("aria-expanded") === "true";
  }
  function watchMenuClose(control, target, request) {
    let expanded = isMenuExpanded(control, request.action);
    let timeout = 0;
    const observer = new MutationObserver(() => {
      const isExpanded = isMenuExpanded(control, request.action);
      expanded ||= isExpanded;
      if (!expanded || isExpanded) return;
      observer.disconnect();
      window.clearTimeout(timeout);
      dispatchActionResult(target, request, { ok: true, phase: "settled" });
    });
    observer.observe(control, {
      attributes: true,
      subtree: true,
      attributeFilter: ["aria-expanded", "class"]
    });
    timeout = window.setTimeout(() => observer.disconnect(), 12e4);
  }
  function queryNativeControl(post, action) {
    for (const selector of ACTION_SELECTORS[action]) {
      const control = post.querySelector(selector);
      if (control) return control;
    }
    return null;
  }
  function readProperty(value, property) {
    if (!value || typeof value !== "object") return void 0;
    const object = value;
    return typeof object.get === "function" ? object.get(property) : object[property];
  }
  function isUsableContainer(value) {
    return Boolean(value) && typeof value === "object" && typeof value.lookup === "function" && value.isDestroying !== true && value.isDestroyed !== true;
  }
  function getDiscourseContainer() {
    if (isUsableContainer(discourseContainer)) return discourseContainer;
    const legacyContainer = pageWindow.Discourse?.__container__;
    if (isUsableContainer(legacyContainer)) {
      discourseContainer = legacyContainer;
      return legacyContainer;
    }
    try {
      const module = pageWindow.require?.("discourse/lib/plugin-api");
      module?.withPluginApi("1.0.0", (api) => {
        if (isUsableContainer(api.container)) discourseContainer = api.container;
      });
    } catch {
      discourseContainer = null;
    }
    return isUsableContainer(discourseContainer) ? discourseContainer : null;
  }
  function lookupDiscourse(name) {
    try {
      return getDiscourseContainer()?.lookup(name);
    } catch {
      discourseContainer = null;
      return void 0;
    }
  }
  function isReplyComposerOpen() {
    return document.getElementById("reply-control")?.classList.contains("open") === true || document.documentElement.classList.contains("composer-open");
  }
  function focusReplyComposer() {
    window.requestAnimationFrame(() => {
      document.querySelector(
        '#reply-control.open .d-editor-input, #reply-control.open textarea, #reply-control.open [contenteditable="true"]'
      )?.focus();
    });
  }
  function waitForReplyComposer(timeoutMs) {
    if (isReplyComposerOpen()) {
      focusReplyComposer();
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let settled = false;
      let timeout = 0;
      const finish = (opened) => {
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
        attributeFilter: ["class"]
      });
      timeout = window.setTimeout(() => finish(false), timeoutMs);
    });
  }
  async function openReplyWithController(request) {
    const candidate = lookupDiscourse("controller:topic");
    if (!candidate || typeof candidate !== "object") return false;
    const controller = candidate;
    const model = readProperty(controller, "model");
    const postStream = readProperty(model, "postStream");
    if (!postStream) return false;
    try {
      let post = postStream.findLoadedPost?.(request.postId);
      if (!post && postStream.loadPost) post = await postStream.loadPost(request.postId);
      if (!post) return false;
      if (typeof controller.replyToPost === "function") {
        await controller.replyToPost.call(controller, post);
        if (await waitForReplyComposer(750)) return true;
      }
      const topic = readProperty(post, "topic") || model;
      const details = readProperty(topic, "details");
      if (readProperty(details, "can_create_post") === false) return false;
      const draftKey = readProperty(topic, "draft_key");
      const draftSequence = readProperty(topic, "draft_sequence");
      const composerCandidate = readProperty(controller, "composer") || lookupDiscourse("service:composer");
      if (typeof draftKey !== "string" || !composerCandidate || typeof composerCandidate !== "object") {
        return false;
      }
      const composer = composerCandidate;
      if (typeof composer.open !== "function") return false;
      await composer.open.call(composer, {
        action: "reply",
        draftKey,
        draftSequence: typeof draftSequence === "number" ? draftSequence : 0,
        ...request.floor === 1 ? { topic } : { post }
      });
      return await waitForReplyComposer(2500);
    } catch {
      return false;
    }
  }
  function canTriggerNativeAction(post, action) {
    if (queryNativeControl(post, action)) return true;
    return COLLAPSED_ACTIONS.has(action) && Boolean(post.querySelector(".post-action-menu__show-more"));
  }
  async function findNativeControl(post, action) {
    let control = queryNativeControl(post, action);
    if (control || !COLLAPSED_ACTIONS.has(action)) return control;
    post.querySelector(".post-action-menu__show-more")?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    control = queryNativeControl(post, action);
    return control;
  }
  async function triggerNativeAction(post, target, request) {
    const control = await findNativeControl(post, request.action);
    if (!control) {
      dispatchActionResult(target, request, {
        ok: false,
        phase: "triggered",
        message: "\u5F53\u524D\u697C\u5C42\u6CA1\u6709\u6B64\u64CD\u4F5C"
      });
      return;
    }
    if (control instanceof HTMLButtonElement && control.disabled) {
      dispatchActionResult(target, request, {
        ok: false,
        phase: "triggered",
        message: "\u5F53\u524D\u64CD\u4F5C\u4E0D\u53EF\u7528"
      });
      return;
    }
    anchorControlToTarget(control, target);
    if (request.action === "bookmark" || request.action === "likeUsers") {
      watchMenuClose(control, target, request);
    }
    control.click();
    if (request.action === "reply") {
      const opened = await waitForReplyComposer(3e3);
      dispatchActionResult(target, request, {
        ok: opened,
        phase: "triggered",
        ...opened ? {} : { message: "\u539F\u7AD9\u56DE\u590D\u6309\u94AE\u5DF2\u89E6\u53D1\uFF0C\u4F46\u56DE\u590D\u9762\u677F\u6CA1\u6709\u6253\u5F00" }
      });
      return;
    }
    dispatchActionResult(target, request, { ok: true, phase: "triggered" });
  }
  function routeToActionPost(target, request, url) {
    if (!pageWindow.require) {
      dispatchActionResult(target, request, {
        ok: false,
        phase: "triggered",
        message: "Discourse \u9875\u9762\u5C1A\u672A\u5C31\u7EEA"
      });
      return;
    }
    let attempting = false;
    let timeout = 0;
    const attemptAction = () => {
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
          phase: "triggered",
          message: getNativePost(request) ? "\u539F\u7AD9\u64CD\u4F5C\u680F\u52A0\u8F7D\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5" : "\u539F\u7AD9\u697C\u5C42\u52A0\u8F7D\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5"
        });
      }
    }, 8e3);
    try {
      const module = pageWindow.require("discourse/lib/url");
      const routeTo = module?.default?.routeTo || module?.routeTo;
      if (!routeTo) throw new Error("routeTo unavailable");
      routeTo.call(module?.default || module, `${url.pathname}${url.search}${url.hash}`);
      window.setTimeout(attemptAction, 0);
    } catch {
      observer.disconnect();
      window.clearTimeout(timeout);
      dispatchActionResult(target, request, {
        ok: false,
        phase: "triggered",
        message: "\u65E0\u6CD5\u5728\u540E\u53F0\u6253\u5F00\u5BF9\u5E94\u697C\u5C42"
      });
    }
  }
  function handleActionRequest(event) {
    if (!(event instanceof CustomEvent) || !(event.target instanceof Element)) return;
    const request = parseTopicActionRequest(event.detail);
    if (!request || request.topicId !== getTopicId()) return;
    const url = validateActionRoute(request);
    if (!url) return;
    const target = event.target;
    const fallbackToNativeAction = () => {
      const post = getNativePost(request);
      if (post && canTriggerNativeAction(post, request.action)) {
        void triggerNativeAction(post, target, request);
      } else {
        routeToActionPost(target, request, url);
      }
    };
    if (request.action === "reply") {
      void openReplyWithController(request).then((opened) => {
        if (opened) {
          dispatchActionResult(target, request, { ok: true, phase: "triggered" });
        } else {
          fallbackToNativeAction();
        }
      });
    } else {
      fallbackToNativeAction();
    }
  }
  function forwardEvent(topicId, value) {
    const detail = sanitizeTopicMessage(topicId, value);
    if (!detail) return;
    document.dispatchEvent(
      new CustomEvent(TOPIC_EVENT_NAME, {
        detail: JSON.stringify(detail)
      })
    );
  }
  function unsubscribe() {
    if (!activeChannel || !activeCallback || !pageWindow.MessageBus) return;
    pageWindow.MessageBus.unsubscribe(activeChannel, activeCallback);
    activeChannel = null;
    activeCallback = null;
  }
  function subscribeToCurrentTopic() {
    const messageBus = pageWindow.MessageBus;
    if (!messageBus) return false;
    const topicId = getTopicId();
    const channel = topicId ? `/topic/${topicId}` : null;
    if (channel === activeChannel) return true;
    unsubscribe();
    if (!topicId || !channel) return true;
    const callback = (data) => forwardEvent(topicId, data);
    const existingCursor = messageBus.callbacks?.find((item) => item.channel === channel)?.last_id;
    if (typeof existingCursor === "number") messageBus.subscribe(channel, callback, existingCursor);
    else messageBus.subscribe(channel, callback);
    activeChannel = channel;
    activeCallback = callback;
    return true;
  }
  function installPluginHook() {
    if (pluginHookInstalled || !pageWindow.require) return pluginHookInstalled;
    try {
      const module = pageWindow.require("discourse/lib/plugin-api");
      if (!module?.withPluginApi) return false;
      module.withPluginApi("1.0.0", (api) => {
        discourseContainer = api.container || null;
        api.onPageChange(() => subscribeToCurrentTopic());
        subscribeToCurrentTopic();
      });
      pluginHookInstalled = true;
      return true;
    } catch {
      return false;
    }
  }
  function discover(attempt = 0) {
    const busReady = subscribeToCurrentTopic();
    const hookReady = installPluginHook();
    if (busReady && hookReady || attempt >= MAX_DISCOVERY_ATTEMPTS) return;
    window.setTimeout(() => discover(attempt + 1), 250);
  }
  window.addEventListener("popstate", () => subscribeToCurrentTopic());
  document.addEventListener("DOMContentLoaded", () => subscribeToCurrentTopic(), { once: true });
  document.addEventListener(TOPIC_ACTION_REQUEST_NAME, handleActionRequest);
  discover();
})();
//# sourceMappingURL=topic-events-bridge.js.map
