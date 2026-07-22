// background.ts — Chrome MV3 Service Worker
// 当前保持最小化：主要业务逻辑在 content.js / popup.js 中。

chrome.runtime.onInstalled.addListener(() => {
  // 预留生命周期入口，确保 manifest 中注册的后台脚本职责明确。
});
