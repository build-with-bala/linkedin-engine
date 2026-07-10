import { z } from "zod";

export const PostType = z.enum(["past", "present", "trend"]);
export type PostType = z.infer<typeof PostType>;

export const PostStatus = z.enum(["idea", "draft", "approved", "scheduled", "posted"]);
export type PostStatus = z.infer<typeof PostStatus>;

export const Stage = z.enum(["hooks", "body", "media", "regenerate"]);
export type Stage = z.infer<typeof Stage>;

/** The minimum a caller must describe about a post to generate for it. */
export const PostInput = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: PostType.or(z.string()),
  pillar: z.string().nullish(),
  beatRef: z.string().nullish(),
  status: PostStatus.optional(),
  body: z.string().nullish(),
  postedUrl: z.string().url().nullish(),
});
export type PostInput = z.infer<typeof PostInput>;

export const ProviderConfigSchema = z.object({
  name: z.string().min(1),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().positive().optional(),
  bin: z.string().optional(),
  args: z.array(z.string()).optional(),
  headers: z.record(z.string()).optional(),
});

/** Request body for `generate` — reused by the HTTP server for validation. */
export const GenerateInput = z.object({
  stage: Stage,
  /** Ordered fallback chain. First entry is primary. */
  providers: z.array(ProviderConfigSchema).min(1),
  promptTemplate: z.string().optional(),
  extraInputs: z.string().optional(),
  includeFullStory: z.boolean().optional(),
  hookCount: z.number().int().min(1).max(20).optional(),
});
export type GenerateInput = z.infer<typeof GenerateInput>;
