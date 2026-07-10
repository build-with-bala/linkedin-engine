import type { PostInput, Stage } from "./types.js";

/**
 * The persistence seam. The original engine called Prisma directly from the
 * orchestrator, which welded it to one schema and one database. Here the engine
 * depends only on this interface, so a host product can back it with Prisma,
 * Drizzle, Mongo, or nothing at all.
 *
 * Every method is optional except `getPost`: an integrator who only wants
 * stateless generation implements one method and ignores the rest.
 */
export interface Store {
  getPost(id: string): Promise<PostInput | null>;
  updatePost?(id: string, patch: Partial<PostInput> & { charCount?: number }): Promise<void>;

  /** Posts published since `since` that carry a live URL — the sweep input. */
  listPostedSince?(since: Date): Promise<PostInput[]>;

  saveHooks?(postId: string, hooks: string[], provider: string): Promise<void>;
  countHooks?(postId: string): Promise<number>;
  saveMedia?(postId: string, prompt: string): Promise<void>;

  recordGeneration?(run: GenerationRecord): Promise<{ id: string }>;
  recordScrape?(run: ScrapeRecord): Promise<{ id: string }>;
  recordMetric?(m: MetricRecord): Promise<void>;

  findComment?(postId: string, externalId: string): Promise<{ id: string } | null>;
  createComment?(c: CommentRecord): Promise<void>;
}

export interface GenerationRecord {
  postId: string;
  provider: string;
  model?: string;
  stage: Stage;
  prompt: string;
  output: string;
  contextChars: number;
  inputs?: unknown;
}

export interface ScrapeRecord {
  postId: string;
  kind: string;
  url: string;
  summary: string | null;
  links: string[];
  raw: string;
  ok: boolean;
  note?: string;
}

export interface MetricRecord {
  postId: string;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
}

export interface CommentRecord {
  postId: string;
  text: string;
  externalId: string;
  draftReply: string | null;
  status: "new" | "drafted";
}

/** In-memory Store for tests, demos, and the CLI. Never for production. */
export class MemoryStore implements Store {
  readonly posts = new Map<string, PostInput>();
  readonly hooks = new Map<string, string[]>();
  readonly media: Array<{ postId: string; prompt: string }> = [];
  readonly generations: Array<GenerationRecord & { id: string }> = [];
  readonly scrapes: Array<ScrapeRecord & { id: string }> = [];
  readonly metrics: MetricRecord[] = [];
  readonly comments: CommentRecord[] = [];
  private seq = 0;

  constructor(posts: PostInput[] = []) {
    for (const p of posts) this.posts.set(p.id, p);
  }

  private id(prefix: string) {
    return `${prefix}_${++this.seq}`;
  }

  async getPost(id: string) {
    return this.posts.get(id) ?? null;
  }

  async updatePost(id: string, patch: Partial<PostInput>) {
    const cur = this.posts.get(id);
    if (cur) this.posts.set(id, { ...cur, ...patch });
  }

  async listPostedSince(_since: Date) {
    return [...this.posts.values()].filter((p) => p.status === "posted" && p.postedUrl);
  }

  async saveHooks(postId: string, hooks: string[]) {
    this.hooks.set(postId, hooks);
  }

  async countHooks(postId: string) {
    return this.hooks.get(postId)?.length ?? 0;
  }

  async saveMedia(postId: string, prompt: string) {
    this.media.push({ postId, prompt });
  }

  async recordGeneration(run: GenerationRecord) {
    const rec = { ...run, id: this.id("gen") };
    this.generations.push(rec);
    return { id: rec.id };
  }

  async recordScrape(run: ScrapeRecord) {
    const rec = { ...run, id: this.id("scrape") };
    this.scrapes.push(rec);
    return { id: rec.id };
  }

  async recordMetric(m: MetricRecord) {
    this.metrics.push(m);
  }

  async findComment(postId: string, externalId: string) {
    const c = this.comments.find((x) => x.postId === postId && x.externalId === externalId);
    return c ? { id: c.externalId } : null;
  }

  async createComment(c: CommentRecord) {
    this.comments.push(c);
  }
}
