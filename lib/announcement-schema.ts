import { z } from "zod";
export const announcementSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().max(10000),
    media_path: z
      .string()
      .max(300)
      .regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp|gif)$/)
      .nullable()
      .default(null),
  })
  .refine((v) => Boolean(v.body || v.media_path), "Adicione texto ou imagem.");
export const announcementAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("comment"),
    post_id: z.string().uuid(),
    body: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("react"),
    post_id: z.string().uuid(),
    reaction: z.enum(["❤️", "👏", "👍", "🎉"]).nullable(),
  }),
  z.object({ action: z.literal("delete_post"), post_id: z.string().uuid() }),
  z.object({
    action: z.literal("delete_comment"),
    comment_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("permission"),
    user_id: z.string().uuid(),
    can_publish: z.boolean(),
  }),
]);
