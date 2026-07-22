/* Linux.do 工具箱 — Popup 入口 */
import { getSettings as _getSettings, saveSettings as _saveSettings } from '../common/settings';
import type { DiscourseSettings } from '../common/settings';
import type { ContentMessage } from '../content/messages';

type SettingKey = keyof DiscourseSettings;

interface InfoResponse {
  title: string;
  url: string;
  postCount: number;
}

document.addEventListener('DOMContentLoaded', async () => {
  const infoEl = document.getElementById('info') as HTMLElement | null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;

  const settingInputs: Record<SettingKey, HTMLInputElement | null> = {
    enablePostActions: document.getElementById('enablePostActions') as HTMLInputElement | null,
    enableBase64Decode: document.getElementById('enableBase64Decode') as HTMLInputElement | null,
    enableSplitLayout: document.getElementById('enableSplitLayout') as HTMLInputElement | null,
    includeMetadata: document.getElementById('includeMetadata') as HTMLInputElement | null,
    replaceUploadUrls: document.getElementById('replaceUploadUrls') as HTMLInputElement | null,
  };

  async function loadSettings(): Promise<void> {
    const settings = await _getSettings();
    (Object.entries(settingInputs) as Array<[SettingKey, HTMLInputElement | null]>).forEach(([key, input]) => {
      if (input) input.checked = Boolean(settings[key]);
    });
  }

  async function saveSetting(key: SettingKey, checked: boolean): Promise<void> {
    await _saveSettings({ [key]: checked });
    if (tabId !== undefined) {
      chrome.tabs.sendMessage(tabId, { action: 'refreshEnhancements' } satisfies ContentMessage, {}, () => {});
    }
  }

  (Object.entries(settingInputs) as Array<[SettingKey, HTMLInputElement | null]>).forEach(([key, input]) => {
    if (!input) return;
    input.addEventListener('change', () => {
      saveSetting(key, input.checked).catch((err: Error) => {
        if (infoEl) infoEl.innerHTML = `⚠️ 设置保存失败：${err.message}`;
      });
    });
  });

  await loadSettings();

  if (!tab?.url?.match(/linux\.do\//)) {
    if (infoEl) infoEl.innerHTML = '⚠️ 请在 linux.do 的帖子页面使用此插件';
    document.querySelectorAll<HTMLButtonElement>('.btn').forEach((button) => { button.disabled = true; });
    return;
  }

  if (tabId === undefined) {
    if (infoEl) infoEl.innerHTML = '⚠️ 页面未加载完成，请刷新后重试';
    return;
  }

  chrome.tabs.sendMessage(tabId, { action: 'getInfo' } satisfies ContentMessage, {}, (res: InfoResponse | undefined) => {
    if (chrome.runtime.lastError || !res) {
      if (infoEl) infoEl.innerHTML = '⚠️ 页面未加载完成，请刷新后重试';
      return;
    }
    if (infoEl) {
      infoEl.innerHTML = `
        <div class="title">${res.title}</div>
        <div>当前已加载 ${res.postCount} 个楼层</div>
      `;
    }
  });

  document.getElementById('copyTopic')?.addEventListener('click', () => {
    if (tabId !== undefined) {
      chrome.tabs.sendMessage(tabId, { action: 'copyTopic' } satisfies ContentMessage, {}, () => window.close());
    }
  });

  document.getElementById('downloadTopic')?.addEventListener('click', () => {
    if (tabId !== undefined) {
      chrome.tabs.sendMessage(tabId, { action: 'downloadTopic' } satisfies ContentMessage, {}, () => window.close());
    }
  });
});
