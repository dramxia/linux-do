import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseTopicActionResult,
  parseTopicInteractionResult,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
  TOPIC_INTERACTION_REQUEST_NAME,
  TOPIC_INTERACTION_RESULT_NAME,
  type TopicActionRequest,
  type TopicInteractionRequest,
} from '../src/content/topic-actions';
import {
  HISTORY_NAVIGATION_EVENT_NAME,
  PAGE_NAVIGATION_EVENT_NAME,
} from '../src/common/topic-route';
import { parseTopicEventDetail, TOPIC_EVENT_NAME } from '../src/content/topic-events';
import { TOPIC_CODE_HIGHLIGHT_REQUEST_NAME } from '../src/content/topic-code-blocks';

interface BridgeTestWindow extends Window {
  MessageBus: {
    callbacks: Array<{ channel?: string; last_id?: number }>;
    subscribe: (channel: string) => void;
    unsubscribe: (channel: string) => void;
  };
  require: (moduleName: string) => unknown;
}

const pageWindow = window as unknown as BridgeTestWindow;
let topicController: unknown = null;
let reactionToggleCallback: ((value: unknown) => void) | null = null;
let pageChangeCallback: (() => void) | null = null;
const ajax = vi.fn();
const routeTo = vi.fn();
const preventCloak = vi.fn();
const highlightSyntax = vi.fn();
const siteSettings = {
  autohighlight_all_code: true,
  discourse_reactions_enabled_reactions: 'heart|laughing|cry',
  discourse_reactions_reaction_for_like: 'heart',
};
const session = { highlightJsPath: '/highlight-js/common.js' };

function request(
  action: TopicActionRequest['action'],
  postId = 2,
  extra: Partial<TopicActionRequest> = {},
): TopicActionRequest {
  return {
    requestId: `bridge:${postId}`,
    topicId: 123,
    postId,
    floor: postId,
    action,
    routeUrl: `${window.location.origin}/t/topic/123/${postId}?ldo_comments_page=5`,
    ...(action === 'boost' ? { boostRaw: '支持一下' } : {}),
    ...extra,
  };
}

function dispatchRequest(button: HTMLButtonElement, detail: TopicActionRequest): Promise<unknown> {
  return new Promise((resolve) => {
    button.addEventListener(
      TOPIC_ACTION_RESULT_NAME,
      (event) => resolve(parseTopicActionResult((event as CustomEvent).detail)),
      { once: true },
    );
    button.dispatchEvent(
      new CustomEvent(TOPIC_ACTION_REQUEST_NAME, {
        bubbles: true,
        detail: JSON.stringify(detail),
      }),
    );
  });
}

function dispatchInteraction(
  button: HTMLButtonElement,
  detail: TopicInteractionRequest,
): Promise<unknown> {
  return new Promise((resolve) => {
    button.addEventListener(
      TOPIC_INTERACTION_RESULT_NAME,
      (event) => resolve(parseTopicInteractionResult((event as CustomEvent).detail)),
      { once: true },
    );
    button.dispatchEvent(
      new CustomEvent(TOPIC_INTERACTION_REQUEST_NAME, {
        bubbles: true,
        detail: JSON.stringify(detail),
      }),
    );
  });
}

function installPostController(
  post: Record<string, unknown>,
  methods = {},
): { loadPost: ReturnType<typeof vi.fn> } {
  const loadPost = vi.fn().mockResolvedValue(post);
  topicController = {
    model: {
      id: 123,
      bookmarks: [],
      postStream: { findLoadedPost: vi.fn(), loadPost },
    },
    ...methods,
  };
  return { loadPost };
}

function expectPageUntouched(url: string, scrollTo: ReturnType<typeof vi.spyOn>): void {
  expect(window.location.href).toBe(url);
  expect(routeTo).not.toHaveBeenCalled();
  expect(preventCloak).not.toHaveBeenCalled();
  expect(scrollTo).not.toHaveBeenCalled();
}

beforeAll(async () => {
  pageWindow.MessageBus = {
    callbacks: [],
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
  pageWindow.require = (moduleName: string): unknown => {
    if (moduleName === 'discourse/lib/plugin-api') {
      return {
        withPluginApi: (_version: string, callback: (api: unknown) => void) =>
          callback({
            onPageChange: (pageCallback: () => void) => {
              pageChangeCallback = pageCallback;
            },
            onAppEvent: (name: string, eventCallback: (value: unknown) => void) => {
              if (name === 'discourse-reactions:reaction-toggled') {
                reactionToggleCallback = eventCallback;
              }
            },
            preventCloak,
            container: {
              lookup: (name: string) => {
                if (name === 'service:site-settings') return siteSettings;
                if (name === 'service:session') return session;
                return topicController;
              },
            },
          }),
      };
    }
    if (moduleName === 'discourse/lib/url') return { default: { routeTo } };
    if (moduleName === 'discourse/lib/ajax') return { ajax };
    if (moduleName === 'discourse/lib/text') {
      return {
        emojiUrlFor: (reactionId: string) =>
          `https://cdn.linux.do/images/emoji/twitter/${reactionId}.png`,
      };
    }
    if (moduleName === 'discourse/lib/highlight-syntax') return { default: highlightSyntax };
    return undefined;
  };
  await import('../src/page/topic-events-bridge');
});

beforeEach(() => {
  document.body.innerHTML = '<main id="main-outlet"></main>';
  window.history.replaceState({}, '', '/t/topic/123?ldo_comments_page=5');
  topicController = null;
  ajax.mockReset().mockResolvedValue({ id: 91, cooked: '<p>支持一下</p>' });
  routeTo.mockReset();
  preventCloak.mockReset();
  highlightSyntax.mockReset();
});

describe('page-world topic action bridge', () => {
  it('runs the native Discourse highlighter for split-layout code blocks', async () => {
    const root = document.createElement('section');
    root.className = 'ldtk-topic-reading-root';
    root.innerHTML =
      '<div class="cooked"><pre class="codeblock-buttons"><code>const answer = 42;</code></pre></div>';
    document.body.appendChild(root);

    document.dispatchEvent(new Event(TOPIC_CODE_HIGHLIGHT_REQUEST_NAME));

    await vi.waitFor(() => expect(highlightSyntax).toHaveBeenCalledOnce());
    expect(highlightSyntax).toHaveBeenCalledWith(
      root.querySelector('.cooked'),
      siteSettings,
      session,
    );
  });

  it('dispatches definitive navigation signals for history and completed page changes', () => {
    const historyNavigation = vi.fn();
    const pageNavigation = vi.fn();
    document.addEventListener(HISTORY_NAVIGATION_EVENT_NAME, historyNavigation);
    document.addEventListener(PAGE_NAVIGATION_EVENT_NAME, pageNavigation);

    window.history.pushState({}, '', '/latest');
    pageChangeCallback?.();

    expect(historyNavigation).toHaveBeenCalledOnce();
    expect(pageNavigation).toHaveBeenCalledOnce();
  });

  it('forwards custom reaction state with its emoji URL', async () => {
    const detail = new Promise((resolve) => {
      document.addEventListener(
        TOPIC_EVENT_NAME,
        (event) => resolve(parseTopicEventDetail((event as CustomEvent).detail)),
        { once: true },
      );
    });
    reactionToggleCallback?.({
      post: { id: 2, topic_id: 123, current_user_reaction: { id: 'cry' } },
      reaction: { id: 'cry' },
    });
    await expect(detail).resolves.toEqual({
      topicId: 123,
      type: 'acted',
      postId: 2,
      currentReactionId: 'cry',
      currentReactionUrl: 'https://cdn.linux.do/images/emoji/twitter/cry.png',
    });
  });

  it('returns reaction options without touching native post controls', async () => {
    const visibleButton = document.body.appendChild(document.createElement('button'));
    const url = window.location.href;
    const request: TopicInteractionRequest = {
      requestId: 'options:2',
      topicId: 123,
      postId: 2,
      floor: 2,
      interaction: 'reactionOptions',
      routeUrl: `${window.location.origin}/t/topic/123/2`,
    };

    await expect(dispatchInteraction(visibleButton, request)).resolves.toEqual({
      requestId: 'options:2',
      interaction: 'reactionOptions',
      ok: true,
      reactionOptions: [
        {
          id: 'heart',
          url: 'https://cdn.linux.do/images/emoji/twitter/heart.png',
          isMain: true,
        },
        {
          id: 'laughing',
          url: 'https://cdn.linux.do/images/emoji/twitter/laughing.png',
          isMain: false,
        },
        {
          id: 'cry',
          url: 'https://cdn.linux.do/images/emoji/twitter/cry.png',
          isMain: false,
        },
      ],
    });
    expect(window.location.href).toBe(url);
    expect(document.querySelector('.discourse-reactions-picker')).toBeNull();
  });

  it('loads like users through the data endpoint without native DOM or navigation', async () => {
    ajax.mockResolvedValueOnce({
      post_action_users: [
        {
          id: 9,
          username: 'alice',
          name: 'Alice',
          avatar_template: '/user_avatar/alice/{size}/9.png',
        },
      ],
      total_rows_post_action_users: 1,
    });
    const visibleButton = document.body.appendChild(document.createElement('button'));
    const url = window.location.href;
    await expect(
      dispatchInteraction(visibleButton, {
        requestId: 'users:50',
        topicId: 123,
        postId: 50,
        floor: 50,
        interaction: 'likeUsers',
        page: 0,
        pageSize: 30,
        routeUrl: `${window.location.origin}/t/topic/123/50`,
      }),
    ).resolves.toEqual({
      requestId: 'users:50',
      interaction: 'likeUsers',
      ok: true,
      users: [
        {
          id: 9,
          username: 'alice',
          name: 'Alice',
          avatarTemplate: '/user_avatar/alice/{size}/9.png',
        },
      ],
      total: 1,
      hasMore: false,
    });
    expect(ajax).toHaveBeenCalledWith('/post_action_users', {
      data: { id: 50, post_action_type_id: 2, page: 0, limit: 30 },
    });
    expect(window.location.href).toBe(url);
    expect(document.getElementById('main-outlet')?.childElementCount).toBe(0);
    expect(routeTo).not.toHaveBeenCalled();
  });

  it('toggles a custom reaction directly without loading or routing the post stream', async () => {
    ajax.mockResolvedValueOnce({
      id: 50,
      current_user_reaction: { id: 'cry', can_undo: true },
    });
    const visibleButton = document.body.appendChild(document.createElement('button'));
    const url = window.location.href;
    await expect(
      dispatchRequest(
        visibleButton,
        request('reaction', 50, {
          reactionId: 'cry',
        }),
      ),
    ).resolves.toEqual({
      requestId: 'bridge:50',
      ok: true,
      phase: 'settled',
    });
    expect(ajax).toHaveBeenCalledWith(
      '/discourse-reactions/posts/50/custom-reactions/cry/toggle.json',
      { type: 'PUT' },
    );
    expect(window.location.href).toBe(url);
    expect(topicController).toBeNull();
    expect(routeTo).not.toHaveBeenCalled();
  });

  it('rejects stale-topic interaction requests without touching the page', async () => {
    const visibleButton = document.body.appendChild(document.createElement('button'));
    let settled = false;
    void dispatchInteraction(visibleButton, {
      requestId: 'options:stale',
      topicId: 123,
      postId: 50,
      floor: 50,
      interaction: 'reactionOptions',
      routeUrl: `${window.location.origin}/t/topic/456/50`,
    }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(ajax).not.toHaveBeenCalled();
    expect(routeTo).not.toHaveBeenCalled();
  });

  it('silently loads an unrendered post and toggles its like model', async () => {
    const togglePromise = vi.fn().mockResolvedValue(undefined);
    const post = { id: 50, likeAction: { togglePromise } };
    const { loadPost } = installPostController(post);
    const button = document.body.appendChild(document.createElement('button'));
    const url = window.location.href;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    await expect(dispatchRequest(button, request('like', 50))).resolves.toEqual({
      requestId: 'bridge:50',
      ok: true,
      phase: 'settled',
    });
    expect(loadPost).toHaveBeenCalledWith(50);
    expect(togglePromise).toHaveBeenCalledWith(post);
    expectPageUntouched(url, scrollTo);
  });

  it.each([
    ['bookmark', 'toggleBookmark'],
    ['edit', 'editPost'],
    ['delete', 'deletePostWithConfirmation'],
    ['recover', 'recoverPost'],
    ['flag', 'showPostFlags'],
  ] as const)(
    'runs %s through the loaded post model without navigation',
    async (action, method) => {
      const post = { id: 50 };
      const invoke = vi.fn().mockResolvedValue(undefined);
      const { loadPost } = installPostController(post, { [method]: invoke });
      const button = document.body.appendChild(document.createElement('button'));
      const url = window.location.href;
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

      await expect(dispatchRequest(button, request(action, 50))).resolves.toEqual({
        requestId: 'bridge:50',
        ok: true,
        phase: 'settled',
      });
      expect(loadPost).toHaveBeenCalledWith(50);
      expect(invoke).toHaveBeenCalledWith(post);
      expectPageUntouched(url, scrollTo);
    },
  );

  it('opens replies through the topic controller without navigating', async () => {
    const post = { id: 50 };
    const replyToPost = vi.fn().mockImplementation(async () => {
      const composer = document.createElement('section');
      composer.id = 'reply-control';
      composer.className = 'open';
      document.body.appendChild(composer);
    });
    const { loadPost } = installPostController(post, { replyToPost });
    const button = document.body.appendChild(document.createElement('button'));
    const url = window.location.href;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    await expect(dispatchRequest(button, request('reply', 50))).resolves.toEqual({
      requestId: 'bridge:50',
      ok: true,
      phase: 'settled',
    });
    expect(loadPost).toHaveBeenCalledWith(50);
    expect(replyToPost).toHaveBeenCalledWith(post);
    expectPageUntouched(url, scrollTo);
  });

  it('toggles the solved shared-issue state through the plugin endpoint', async () => {
    ajax.mockResolvedValueOnce({ count: 8, user_created_shared_issue: true });
    const button = document.body.appendChild(document.createElement('button'));
    const url = window.location.href;

    await expect(dispatchRequest(button, request('sharedIssue', 1))).resolves.toEqual({
      requestId: 'bridge:1',
      ok: true,
      phase: 'settled',
      sharedIssueCount: 8,
      userCreatedSharedIssue: true,
    });
    expect(ajax).toHaveBeenCalledWith('/solution/shared_issue', {
      type: 'POST',
      data: { topic_id: 123 },
    });
    expect(window.location.href).toBe(url);
    expect(topicController).toBeNull();
    expect(routeTo).not.toHaveBeenCalled();
  });

  it('submits Boost directly through the plugin endpoint without touching page state', async () => {
    const button = document.body.appendChild(document.createElement('button'));
    const url = window.location.href;
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    await expect(dispatchRequest(button, request('boost', 50))).resolves.toEqual({
      requestId: 'bridge:50',
      ok: true,
      phase: 'settled',
    });
    expect(ajax).toHaveBeenCalledWith('/discourse-boosts/posts/50/boosts', {
      type: 'POST',
      data: { raw: '支持一下' },
    });
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expectPageUntouched(url, scrollTo);
  });

  it('returns a quiet inline error when Boost fails and never falls back to navigation', async () => {
    ajax.mockRejectedValue({ responseJSON: { errors: ['你已经助推过此楼层'] } });
    const button = document.body.appendChild(document.createElement('button'));
    const url = window.location.href;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    await expect(dispatchRequest(button, request('boost', 50))).resolves.toEqual({
      requestId: 'bridge:50',
      ok: false,
      phase: 'settled',
      message: '你已经助推过此楼层',
    });
    expectPageUntouched(url, scrollTo);
  });

  it('reports unavailable silent actions instead of clicking hidden native controls', async () => {
    const nativePost = document.createElement('article');
    nativePost.dataset.postId = '50';
    const nativeButton = document.createElement('button');
    nativeButton.className = 'post-action-menu__edit';
    const click = vi.fn();
    nativeButton.addEventListener('click', click);
    nativePost.appendChild(nativeButton);
    document.getElementById('main-outlet')?.appendChild(nativePost);
    const button = document.body.appendChild(document.createElement('button'));
    const url = window.location.href;

    await expect(dispatchRequest(button, request('edit', 50))).resolves.toMatchObject({
      requestId: 'bridge:50',
      ok: false,
      phase: 'settled',
    });
    expect(click).not.toHaveBeenCalled();
    expect(window.location.href).toBe(url);
    expect(routeTo).not.toHaveBeenCalled();
  });
});
