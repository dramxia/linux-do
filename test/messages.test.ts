import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMessageHandlers } from '../src/content/messages';
import { resetChromeMock, setupChromeMock, type ChromeMock } from './mocks/chrome';

let chromeMock: ChromeMock;

function appendPost(): void {
  const post = document.createElement('article');
  post.className = 'topic-post';
  post.dataset.postId = '10';
  post.dataset.postNumber = '1';
  post.innerHTML = `
    <div class="names"><span class="username">alice</span></div>
    <time datetime="2026-08-21T12:00:00Z"></time>
  `;
  document.body.appendChild(post);
}

describe('content messages', () => {
  beforeEach(() => {
    chromeMock = setupChromeMock();
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://linux.do',
        pathname: '/t/topic/123',
      },
      configurable: true,
    });
    document.body.innerHTML = '<h1 class="fancy-title">Test Topic</h1>';
    registerMessageHandlers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    resetChromeMock();
    vi.restoreAllMocks();
  });

  it('returns the current topic information', () => {
    appendPost();
    const sendResponse = vi.fn();
    const listener = chromeMock.runtime.onMessage.listeners[0];

    const keepsChannelOpen = listener?.(
      { action: 'getInfo' },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepsChannelOpen).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      title: 'Test Topic',
      postCount: 1,
    });
  });

  it('copies a topic and preserves the export response contract', async () => {
    appendPost();
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => '# Hello',
      } as Response;
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const listener = chromeMock.runtime.onMessage.listeners[0];
    const response = await new Promise<Record<string, unknown>>((resolve) => {
      const keepsChannelOpen = listener?.(
        { action: 'copyTopic' },
        {} as chrome.runtime.MessageSender,
        (value) => resolve(value as Record<string, unknown>),
      );
      expect(keepsChannelOpen).toBe(true);
    });

    expect(response).toMatchObject({
      success: true,
      total: 1,
      successCount: 1,
      failureCount: 0,
    });
    expect(response.posts).toHaveLength(1);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# Hello'));
  });
});
