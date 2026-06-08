// background.js — Service Worker
// 保持最小化，主要逻辑在 content.js 中

chrome.action.onClicked.addListener(async (tab) => {
  // 点击图标时，如果在 linux.do 则打开 popup
  // 默认已有 popup.html，这里不需要额外处理
});
