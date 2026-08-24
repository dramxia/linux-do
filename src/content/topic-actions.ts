/* Linux.do 工具箱 - 双栏静默操作的跨 world 消息协议 */

export const TOPIC_ACTION_REQUEST_NAME = 'ldtk:topic-action-request';
export const TOPIC_ACTION_RESULT_NAME = 'ldtk:topic-action-result';
export const TOPIC_INTERACTION_REQUEST_NAME = 'ldtk:topic-interaction-request';
export const TOPIC_INTERACTION_RESULT_NAME = 'ldtk:topic-interaction-result';

const TOPIC_ACTIONS = [
  'like',
  'reaction',
  'bookmark',
  'boost',
  'reply',
  'edit',
  'delete',
  'recover',
  'flag',
  'share',
  'sharedIssue',
] as const;
const TOPIC_INTERACTIONS = ['reactionOptions', 'likeUsers'] as const;

export type TopicAction = (typeof TOPIC_ACTIONS)[number];
export type TopicInteraction = (typeof TOPIC_INTERACTIONS)[number];
type TopicActionResultPhase = 'triggered' | 'settled';

export interface TopicActionRequest {
  requestId: string;
  topicId: number;
  postId: number;
  floor: number;
  action: TopicAction;
  routeUrl: string;
  boostRaw?: string;
  reactionId?: string;
}

export interface TopicActionResult {
  requestId: string;
  ok: boolean;
  phase: TopicActionResultPhase;
  message?: string;
  sharedIssueCount?: number;
  userCreatedSharedIssue?: boolean;
}

export interface TopicInteractionRequest {
  requestId: string;
  topicId: number;
  postId: number;
  floor: number;
  interaction: TopicInteraction;
  routeUrl: string;
  page?: number;
  pageSize?: number;
}

export interface TopicReactionOption {
  id: string;
  url: string;
  isMain: boolean;
}

export interface TopicInteractionUser {
  id?: number;
  username: string;
  name?: string;
  avatarTemplate?: string;
}

export interface TopicInteractionResult {
  requestId: string;
  interaction: TopicInteraction;
  ok: boolean;
  message?: string;
  reactionOptions?: TopicReactionOption[];
  users?: TopicInteractionUser[];
  total?: number;
  hasMore?: boolean;
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value);
}

function isRouteUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048;
}

function isReactionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 100 &&
    !/[\u0000-\u001f]/.test(value)
  );
}

function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value, window.location.origin).protocol);
  } catch {
    return false;
  }
}

export function parseTopicActionRequest(value: unknown): TopicActionRequest | null {
  const parsed = parseSerialized(value);
  if (!parsed || typeof parsed !== 'object') return null;
  const detail = parsed as Partial<TopicActionRequest>;
  if (
    !isRequestId(detail.requestId) ||
    !isPositiveInteger(detail.topicId) ||
    !isPositiveInteger(detail.postId) ||
    !isPositiveInteger(detail.floor) ||
    !TOPIC_ACTIONS.includes(detail.action as TopicAction) ||
    !isRouteUrl(detail.routeUrl) ||
    (detail.boostRaw !== undefined &&
      (typeof detail.boostRaw !== 'string' ||
        detail.boostRaw.length === 0 ||
        detail.boostRaw.length > 1000)) ||
    (detail.reactionId !== undefined && !isReactionId(detail.reactionId)) ||
    (detail.action === 'boost' && detail.boostRaw === undefined) ||
    (detail.action === 'reaction' && detail.reactionId === undefined) ||
    (detail.action !== 'boost' && detail.boostRaw !== undefined) ||
    (detail.action !== 'reaction' && detail.reactionId !== undefined)
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
    ...(detail.boostRaw === undefined ? {} : { boostRaw: detail.boostRaw }),
    ...(detail.reactionId === undefined ? {} : { reactionId: detail.reactionId }),
  };
}

export function parseTopicActionResult(value: unknown): TopicActionResult | null {
  const parsed = parseSerialized(value);
  if (!parsed || typeof parsed !== 'object') return null;
  const detail = parsed as Partial<TopicActionResult>;
  const hasSharedIssueCount = detail.sharedIssueCount !== undefined;
  const hasSharedIssueState = detail.userCreatedSharedIssue !== undefined;
  if (
    !isRequestId(detail.requestId) ||
    typeof detail.ok !== 'boolean' ||
    !['triggered', 'settled'].includes(detail.phase as TopicActionResultPhase) ||
    (detail.message !== undefined && typeof detail.message !== 'string') ||
    hasSharedIssueCount !== hasSharedIssueState ||
    (hasSharedIssueCount && !isNonNegativeInteger(detail.sharedIssueCount)) ||
    (hasSharedIssueState && typeof detail.userCreatedSharedIssue !== 'boolean')
  ) {
    return null;
  }
  return {
    requestId: detail.requestId,
    ok: detail.ok,
    phase: detail.phase as TopicActionResultPhase,
    ...(detail.message === undefined ? {} : { message: detail.message }),
    ...(detail.sharedIssueCount === undefined ? {} : { sharedIssueCount: detail.sharedIssueCount }),
    ...(detail.userCreatedSharedIssue === undefined
      ? {}
      : { userCreatedSharedIssue: detail.userCreatedSharedIssue }),
  };
}

export function parseTopicInteractionRequest(value: unknown): TopicInteractionRequest | null {
  const parsed = parseSerialized(value);
  if (!parsed || typeof parsed !== 'object') return null;
  const detail = parsed as Partial<TopicInteractionRequest>;
  if (
    !isRequestId(detail.requestId) ||
    !isPositiveInteger(detail.topicId) ||
    !isPositiveInteger(detail.postId) ||
    !isPositiveInteger(detail.floor) ||
    !TOPIC_INTERACTIONS.includes(detail.interaction as TopicInteraction) ||
    !isRouteUrl(detail.routeUrl) ||
    (detail.page !== undefined && !isNonNegativeInteger(detail.page)) ||
    (detail.pageSize !== undefined &&
      (!isPositiveInteger(detail.pageSize) || detail.pageSize > 100)) ||
    (detail.interaction === 'likeUsers' &&
      (detail.page === undefined || detail.pageSize === undefined)) ||
    (detail.interaction === 'reactionOptions' &&
      (detail.page !== undefined || detail.pageSize !== undefined))
  ) {
    return null;
  }
  return {
    requestId: detail.requestId,
    topicId: detail.topicId,
    postId: detail.postId,
    floor: detail.floor,
    interaction: detail.interaction as TopicInteraction,
    routeUrl: detail.routeUrl,
    ...(detail.page === undefined ? {} : { page: detail.page }),
    ...(detail.pageSize === undefined ? {} : { pageSize: detail.pageSize }),
  };
}

function parseReactionOptions(value: unknown): TopicReactionOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: TopicReactionOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const option = item as Partial<TopicReactionOption>;
    if (
      !isReactionId(option.id) ||
      !isSafeImageUrl(option.url) ||
      typeof option.isMain !== 'boolean'
    ) {
      return null;
    }
    options.push({ id: option.id, url: option.url, isMain: option.isMain });
  }
  return options;
}

function parseInteractionUsers(value: unknown): TopicInteractionUser[] | null {
  if (!Array.isArray(value)) return null;
  const users: TopicInteractionUser[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const user = item as Partial<TopicInteractionUser>;
    if (
      (user.id !== undefined && !isPositiveInteger(user.id)) ||
      typeof user.username !== 'string' ||
      user.username.length === 0 ||
      user.username.length > 100 ||
      (user.name !== undefined && typeof user.name !== 'string') ||
      (user.avatarTemplate !== undefined && typeof user.avatarTemplate !== 'string')
    ) {
      return null;
    }
    users.push({
      ...(user.id === undefined ? {} : { id: user.id }),
      username: user.username,
      ...(user.name === undefined ? {} : { name: user.name }),
      ...(user.avatarTemplate === undefined ? {} : { avatarTemplate: user.avatarTemplate }),
    });
  }
  return users;
}

export function parseTopicInteractionResult(value: unknown): TopicInteractionResult | null {
  const parsed = parseSerialized(value);
  if (!parsed || typeof parsed !== 'object') return null;
  const detail = parsed as Partial<TopicInteractionResult>;
  if (
    !isRequestId(detail.requestId) ||
    !TOPIC_INTERACTIONS.includes(detail.interaction as TopicInteraction) ||
    typeof detail.ok !== 'boolean' ||
    (detail.message !== undefined && typeof detail.message !== 'string')
  ) {
    return null;
  }
  const reactionOptions =
    detail.reactionOptions === undefined ? undefined : parseReactionOptions(detail.reactionOptions);
  const users = detail.users === undefined ? undefined : parseInteractionUsers(detail.users);
  if (
    reactionOptions === null ||
    users === null ||
    (detail.total !== undefined && !isNonNegativeInteger(detail.total)) ||
    (detail.hasMore !== undefined && typeof detail.hasMore !== 'boolean') ||
    (detail.ok && detail.interaction === 'reactionOptions' && reactionOptions === undefined) ||
    (detail.ok && detail.interaction === 'likeUsers' && users === undefined)
  ) {
    return null;
  }
  return {
    requestId: detail.requestId,
    interaction: detail.interaction as TopicInteraction,
    ok: detail.ok,
    ...(detail.message === undefined ? {} : { message: detail.message }),
    ...(reactionOptions === undefined ? {} : { reactionOptions }),
    ...(users === undefined ? {} : { users }),
    ...(detail.total === undefined ? {} : { total: detail.total }),
    ...(detail.hasMore === undefined ? {} : { hasMore: detail.hasMore }),
  };
}
