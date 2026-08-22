/* Linux.do 工具箱 - 双栏操作栏跨 world 消息协议 */

export const TOPIC_ACTION_REQUEST_NAME = 'ldtk:topic-action-request';
export const TOPIC_ACTION_RESULT_NAME = 'ldtk:topic-action-result';
export const TOPIC_REACTION_PICKER_REQUEST_NAME = 'ldtk:reaction-picker-request';

const TOPIC_ACTIONS = [
  'like',
  'likeUsers',
  'bookmark',
  'boost',
  'reply',
  'edit',
  'delete',
  'recover',
  'flag',
  'share',
] as const;

export type TopicAction = (typeof TOPIC_ACTIONS)[number];
type TopicActionResultPhase = 'triggered' | 'settled';

export interface TopicActionRequest {
  requestId: string;
  topicId: number;
  postId: number;
  floor: number;
  action: TopicAction;
  routeUrl: string;
}

export interface TopicActionResult {
  requestId: string;
  ok: boolean;
  phase: TopicActionResultPhase;
  message?: string;
}

export interface TopicReactionPickerRequest {
  topicId: number;
  postId: number;
  floor: number;
  open: boolean;
  routeUrl: string;
}

function parseSerialized(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function parseTopicActionRequest(value: unknown): TopicActionRequest | null {
  const parsed = parseSerialized(value);
  if (!parsed || typeof parsed !== 'object') return null;
  const detail = parsed as Partial<TopicActionRequest>;
  if (
    typeof detail.requestId !== 'string' ||
    !/^[a-zA-Z0-9:_-]{1,100}$/.test(detail.requestId) ||
    !isPositiveInteger(detail.topicId) ||
    !isPositiveInteger(detail.postId) ||
    !isPositiveInteger(detail.floor) ||
    !TOPIC_ACTIONS.includes(detail.action as TopicAction) ||
    typeof detail.routeUrl !== 'string' ||
    detail.routeUrl.length === 0 ||
    detail.routeUrl.length > 2048
  ) {
    return null;
  }
  return {
    requestId: detail.requestId,
    topicId: detail.topicId,
    postId: detail.postId,
    floor: detail.floor,
    action: detail.action as TopicAction,
    routeUrl: detail.routeUrl,
  };
}

export function parseTopicActionResult(value: unknown): TopicActionResult | null {
  const parsed = parseSerialized(value);
  if (!parsed || typeof parsed !== 'object') return null;
  const detail = parsed as Partial<TopicActionResult>;
  if (
    typeof detail.requestId !== 'string' ||
    !/^[a-zA-Z0-9:_-]{1,100}$/.test(detail.requestId) ||
    typeof detail.ok !== 'boolean' ||
    !['triggered', 'settled'].includes(detail.phase as TopicActionResultPhase) ||
    (detail.message !== undefined && typeof detail.message !== 'string')
  ) {
    return null;
  }
  return {
    requestId: detail.requestId,
    ok: detail.ok,
    phase: detail.phase as TopicActionResultPhase,
    ...(detail.message === undefined ? {} : { message: detail.message }),
  };
}

export function parseTopicReactionPickerRequest(value: unknown): TopicReactionPickerRequest | null {
  const parsed = parseSerialized(value);
  if (!parsed || typeof parsed !== 'object') return null;
  const detail = parsed as Partial<TopicReactionPickerRequest>;
  if (
    !isPositiveInteger(detail.topicId) ||
    !isPositiveInteger(detail.postId) ||
    !isPositiveInteger(detail.floor) ||
    typeof detail.open !== 'boolean' ||
    typeof detail.routeUrl !== 'string' ||
    detail.routeUrl.length === 0 ||
    detail.routeUrl.length > 2048
  ) {
    return null;
  }
  return {
    topicId: detail.topicId,
    postId: detail.postId,
    floor: detail.floor,
    open: detail.open,
    routeUrl: detail.routeUrl,
  };
}
