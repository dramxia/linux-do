// chrome-types 补充声明：lastError 在 chrome-types 中仅作为 JSDoc 引用存在，
// 但它是 Chrome 运行时真实存在的属性。这里以最小扩展补齐类型，避免在每个调用点
// 使用 as 断言。
declare namespace chrome.runtime {
  export const lastError: { message: string } | undefined;
}
