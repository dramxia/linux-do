/* Linux.do 工具箱 - Discourse 主题 JSON 客户端 */

const MEGA_TOPIC_POST_LIMIT = 10_000;
const POST_BATCH_SIZE = 20;

export interface TopicPostAction {
  id: number;
  count?: number;
  can_act?: boolean;
  acted?: boolean;
}

export interface TopicPostReaction {
  id: string;
  type?: string;
  count: number;
  emoji_url?: string;
  users?: TopicParticipant[];
}

export interface TopicParticipant {
  id?: number;
  username: string;
  name?: string | null;
  avatar_template?: string;
  post_count?: number;
  primary_group_name?: string | null;
}

export interface TopicLink {
  url?: string;
  title?: string;
  clicks?: number;
  internal?: boolean;
  attachment?: boolean;
}

export interface TopicBoost {
  id: number;
  cooked: string;
  can_delete?: boolean;
  can_flag?: boolean;
  user?: TopicParticipant | null;
}

export interface TopicPostCurrentReaction {
  id: string;
  type?: string;
  can_undo?: boolean;
}

export interface TopicPost {
  id: number;
  topic_id: number;
  post_number: number;
  username: string;
  name?: string;
  display_username?: string;
  avatar_template?: string;
  created_at: string;
  updated_at?: string;
  cooked: string;
  reply_to_post_number?: number | null;
  reply_count?: number;
  yours?: boolean;
  actions_summary?: TopicPostAction[];
  reactions?: TopicPostReaction[];
  reaction_users_count?: number;
  current_user_reaction?: TopicPostCurrentReaction | null;
  current_user_used_main_reaction?: boolean;
  boosts?: TopicBoost[];
  can_boost?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  can_recover?: boolean;
  bookmarked?: boolean;
  bookmark_id?: number | null;
  bookmark_reminder_at?: string | null;
  hidden?: boolean;
  deleted_at?: string | null;
  user_title?: string | null;
  primary_group_name?: string | null;
}

export interface TopicResponse {
  id: number;
  title: string;
  fancy_title?: string;
  slug?: string;
  posts_count: number;
  highest_post_number?: number;
  last_read_post_number?: number;
  views?: number;
  reply_count?: number;
  like_count?: number;
  participant_count?: number;
  word_count?: number;
  details?: {
    can_create_post?: boolean;
    participants?: TopicParticipant[];
    links?: TopicLink[];
  };
  post_stream: {
    posts: TopicPost[];
    stream: number[];
  };
}

interface PostsResponse {
  post_stream?: {
    posts?: TopicPost[];
  };
}

function assertOk(response: Response): Response {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isTopicPost(value: unknown): value is TopicPost {
  if (!value || typeof value !== 'object') return false;
  const post = value as Partial<TopicPost>;
  return (
    isFinitePositiveInteger(post.id) &&
    isFinitePositiveInteger(post.topic_id) &&
    isFinitePositiveInteger(post.post_number) &&
    typeof post.username === 'string' &&
    typeof post.created_at === 'string' &&
    typeof post.cooked === 'string'
  );
}

export function parseTopicResponse(value: unknown): TopicResponse {
  if (!value || typeof value !== 'object') throw new Error('主题数据格式无效');
  const topic = value as Partial<TopicResponse>;
  const stream = topic.post_stream?.stream;
  const posts = topic.post_stream?.posts;
  if (
    !isFinitePositiveInteger(topic.id) ||
    typeof topic.title !== 'string' ||
    typeof topic.posts_count !== 'number' ||
    !Array.isArray(stream) ||
    !stream.every(isFinitePositiveInteger) ||
    !Array.isArray(posts) ||
    !posts.every(isTopicPost)
  ) {
    throw new Error('主题数据格式无效');
  }
  return topic as TopicResponse;
}

async function fetchTopic(
  topicId: string,
  signal?: AbortSignal,
  floor?: number,
): Promise<TopicResponse> {
  const floorSegment = floor && floor > 1 ? `/${Math.trunc(floor)}` : '';
  const response = await fetch(
    `/t/${encodeURIComponent(topicId)}${floorSegment}.json?track_visit=true&forceLoad=true`,
    {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    },
  );
  return parseTopicResponse(await assertOk(response).json());
}

export function buildPostsUrl(topicId: string, postIds: readonly number[]): string {
  const params = new URLSearchParams();
  postIds.forEach((postId) => params.append('post_ids[]', String(postId)));
  return `/t/${encodeURIComponent(topicId)}/posts.json?${params.toString()}`;
}

export async function fetchPosts(
  topicId: string,
  postIds: readonly number[],
  signal?: AbortSignal,
): Promise<TopicPost[]> {
  if (postIds.length === 0) return [];
  const response = await fetch(buildPostsUrl(topicId, postIds), {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload = (await assertOk(response).json()) as PostsResponse;
  const posts = payload.post_stream?.posts;
  if (!Array.isArray(posts) || !posts.every(isTopicPost)) {
    throw new Error('楼层数据格式无效');
  }

  const byId = new Map(posts.map((post) => [post.id, post]));
  return postIds.flatMap((postId) => {
    const post = byId.get(postId);
    return post ? [post] : [];
  });
}

export async function fetchPostReplies(
  postId: number,
  after = 1,
  signal?: AbortSignal,
): Promise<TopicPost[]> {
  const params = new URLSearchParams({ after: String(Math.max(1, Math.trunc(after))) });
  const response = await fetch(`/posts/${encodeURIComponent(String(postId))}/replies?${params}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  const replies = (await assertOk(response).json()) as unknown;
  if (!Array.isArray(replies) || !replies.every(isTopicPost)) {
    throw new Error('回复数据格式无效');
  }
  return replies;
}

export class TopicDataSource {
  readonly topic: TopicResponse;
  article: TopicPost;
  readonly commentPostIds: readonly number[];
  private readonly cache = new Map<number, TopicPost>();
  private readonly cacheByPostNumber = new Map<number, TopicPost>();

  private constructor(topic: TopicResponse, article: TopicPost) {
    this.topic = topic;
    this.article = article;
    topic.post_stream.posts.forEach((post) => this.cachePost(post));
    this.commentPostIds = topic.post_stream.stream.filter((postId) => postId !== article.id);
  }

  static async create(
    topicId: string,
    signal?: AbortSignal,
    floor?: number,
  ): Promise<TopicDataSource> {
    const topic = await fetchTopic(topicId, signal, floor);
    let article = topic.post_stream.posts.find((post) => post.post_number === 1);
    if (!article) {
      const initialIds = topic.post_stream.stream.slice(0, POST_BATCH_SIZE);
      const initialPosts = await fetchPosts(topicId, initialIds, signal);
      initialPosts.forEach((post) => topic.post_stream.posts.push(post));
      article = initialPosts.find((post) => post.post_number === 1);
    }
    if (!article) throw new Error('未找到主题正文');
    return new TopicDataSource(topic, article);
  }

  get commentCount(): number {
    return this.commentPostIds.length;
  }

  get isMegaTopic(): boolean {
    return (
      this.topic.posts_count >= MEGA_TOPIC_POST_LIMIT ||
      this.topic.post_stream.stream.length >= MEGA_TOPIC_POST_LIMIT
    );
  }

  getCachedPost(postId: number): TopicPost | undefined {
    return this.cache.get(postId);
  }

  getCachedPostByNumber(postNumber: number): TopicPost | undefined {
    return this.cacheByPostNumber.get(postNumber);
  }

  async loadPage(page: number, perPage: number, signal?: AbortSignal): Promise<TopicPost[]> {
    const start = (page - 1) * perPage;
    const ids = this.commentPostIds.slice(start, start + perPage);
    await this.loadPosts(ids, signal);

    const replyTargetIds = ids.flatMap((postId) => {
      const targetFloor = this.cache.get(postId)?.reply_to_post_number;
      if (!targetFloor) return [];
      const targetId = this.topic.post_stream.stream[targetFloor - 1];
      return targetId ? [targetId] : [];
    });
    await this.loadPosts([...new Set(replyTargetIds)], signal);

    return ids.map((postId, index) => {
      const post = this.cache.get(postId);
      return (
        post || {
          id: postId,
          topic_id: this.topic.id,
          post_number: start + index + 2,
          username: 'system',
          created_at: '',
          cooked: '<p>此回复不可见或已删除</p>',
          hidden: true,
        }
      );
    });
  }

  private async loadPosts(postIds: readonly number[], signal?: AbortSignal): Promise<void> {
    const missingIds = postIds.filter((postId) => !this.cache.has(postId));

    for (let index = 0; index < missingIds.length; index += POST_BATCH_SIZE) {
      const posts = await fetchPosts(
        String(this.topic.id),
        missingIds.slice(index, index + POST_BATCH_SIZE),
        signal,
      );
      posts.forEach((post) => this.cachePost(post));
    }
  }

  private cachePost(post: TopicPost): void {
    const previous = this.cache.get(post.id);
    if (previous && previous.post_number !== post.post_number) {
      this.cacheByPostNumber.delete(previous.post_number);
    }
    this.cache.set(post.id, post);
    this.cacheByPostNumber.set(post.post_number, post);
  }

  async refreshPost(postId: number, signal?: AbortSignal): Promise<TopicPost | null> {
    const [post] = await fetchPosts(String(this.topic.id), [postId], signal);
    if (!post) {
      this.invalidatePost(postId);
      return null;
    }
    this.cachePost(post);
    if (post.post_number === 1) this.article = post;
    return post;
  }

  invalidatePost(postId: number): void {
    const post = this.cache.get(postId);
    if (post) this.cacheByPostNumber.delete(post.post_number);
    this.cache.delete(postId);
  }
}
