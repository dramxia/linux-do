/* Linux.do 工具箱 - MAIN world 主题事件桥的隔离层校验 */

export const TOPIC_EVENT_NAME = 'ldtk:topic-event';

export const TOPIC_EVENT_TYPES = [
  'created',
  'revised',
  'rebaked',
  'deleted',
  'destroyed',
  'recovered',
] as const;

export type TopicEventType = (typeof TOPIC_EVENT_TYPES)[number];

export interface TopicEventDetail {
  topicId: number;
  type: TopicEventType;
  postId: number;
  updatedAt?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function toPositiveInteger(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
}

export function sanitizeTopicMessage(topicId: number, value: unknown): TopicEventDetail | null {
  const data = asRecord(value);
  if (!data || typeof data.type !== 'string') return null;
  const post = asRecord(data.post);
  const postId =
    toPositiveInteger(data.post_id) || toPositiveInteger(data.id) || toPositiveInteger(post?.id);
  const eventTopicId =
    toPositiveInteger(data.topic_id) || toPositiveInteger(post?.topic_id) || topicId;
  if (!postId || eventTopicId !== topicId) return null;
  const updatedAt =
    typeof data.updated_at === 'string'
      ? data.updated_at
      : typeof post?.updated_at === 'string'
        ? post.updated_at
        : undefined;
  return parseTopicEventDetail({
    topicId,
    type: data.type,
    postId,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  });
}

export function parseTopicEventDetail(value: unknown): TopicEventDetail | null {
  let parsedValue = value;
  if (typeof value === 'string') {
    try {
      parsedValue = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsedValue || typeof parsedValue !== 'object') return null;
  const detail = parsedValue as Partial<TopicEventDetail>;
  if (
    !Number.isInteger(detail.topicId) ||
    Number(detail.topicId) <= 0 ||
    !Number.isInteger(detail.postId) ||
    Number(detail.postId) <= 0 ||
    !TOPIC_EVENT_TYPES.includes(detail.type as TopicEventType) ||
    (detail.updatedAt !== undefined && typeof detail.updatedAt !== 'string')
  ) {
    return null;
  }
  return {
    topicId: detail.topicId as number,
    type: detail.type as TopicEventType,
    postId: detail.postId as number,
    ...(detail.updatedAt === undefined ? {} : { updatedAt: detail.updatedAt }),
  };
}
