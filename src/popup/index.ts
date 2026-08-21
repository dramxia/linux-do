/* Linux.do 工具箱 — Popup 入口 */
import { getSettings, saveSettings, SETTING_KEYS } from '../common/settings';
import type { SettingKey } from '../common/settings';
import type { ContentMessage, PageInfoResponse } from '../content/messages';
import { isSupportedPageUrl, renderPageInfo } from './security';

document.addEventListener('DOMContentLoaded', async () => {
  const infoEl = document.getElementById('info') as HTMLElement | null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;

  const settingInputs = new Map<SettingKey, HTMLInputElement | null>(
    SETTING_KEYS.map((key) => [key, document.getElementById(key) as HTMLInputElement | null]),
  );

  async function loadSettings(): Promise<void> {
    const settings = await getSettings();
    settingInputs.forEach((input, key) => {
      if (input) input.checked = settings[key];
    });
  }

  settingInputs.forEach((input, key) => {
    if (!input) return;
    input.addEventListener('change', () => {
      saveSettings({ [key]: input.checked }).catch((err: Error) => {
        if (infoEl) infoEl.textContent = `⚠️ 设置保存失败：${err.message}`;
      });
    });
  });

  await loadSettings();

  if (!isSupportedPageUrl(tab?.url)) {
    if (infoEl) infoEl.textContent = '⚠️ 请在 linux.do 的帖子页面使用此插件';
    document.querySelectorAll<HTMLButtonElement>('.btn').forEach((button) => {
      button.disabled = true;
    });
    return;
  }

  if (tabId === undefined) {
    if (infoEl) infoEl.textContent = '⚠️ 页面未加载完成，请刷新后重试';
    return;
  }

  chrome.tabs.sendMessage(
    tabId,
    { action: 'getInfo' } satisfies ContentMessage,
    {},
    (res: PageInfoResponse | undefined) => {
      if (chrome.runtime.lastError || !res) {
        if (infoEl) infoEl.textContent = '⚠️ 页面未加载完成，请刷新后重试';
        return;
      }
      if (infoEl) {
        renderPageInfo(infoEl, res.title, res.postCount);
      }
    },
  );

  const topicActions = ['copyTopic', 'downloadTopic'] as const;
  topicActions.forEach((action) => {
    document.getElementById(action)?.addEventListener('click', () => {
      chrome.tabs.sendMessage(tabId, { action } satisfies ContentMessage, {}, () => window.close());
    });
  });
});
