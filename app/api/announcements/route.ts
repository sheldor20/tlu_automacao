import {
  paymentActor,
  paymentDb,
  paymentBody,
  paymentFailure,
  paymentJson,
  PaymentError,
} from "@/lib/payment-server";
import {
  announcementAction,
  announcementSchema,
} from "@/lib/announcement-schema";
async function context(request: Request) {
  const db = paymentDb();
  const actor = (await paymentActor(request, db))!;
  const p = await db
    .from("announcement_publishers")
    .select("user_id")
    .eq("user_id", actor.id)
    .maybeSingle();
  if (p.error) throw p.error;
  return { db, actor, canPublish: actor.admin || Boolean(p.data) };
}
export async function GET(request: Request) {
  try {
    const { db, actor, canPublish } = await context(request);
    if (new URL(request.url).searchParams.has("permissions")) {
      if (!actor.admin)
        throw new PaymentError("Acesso restrito à administração.", 403);
      const result = await db.from("announcement_publishers").select("user_id");
      if (result.error) throw result.error;
      return paymentJson(result.data);
    }
    const result = await db
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (result.error) throw result.error;
    const ids = (result.data || []).map((p) => p.id);
    const [comments, reactions] = ids.length
      ? await Promise.all([
          db
            .from("announcement_comments")
            .select("*")
            .in("post_id", ids)
            .order("created_at"),
          db
            .from("announcement_reactions")
            .select("post_id,user_id,reaction")
            .in("post_id", ids),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];
    if (comments.error || reactions.error)
      throw comments.error || reactions.error;
    const posts = await Promise.all(
      (result.data || []).map(async (p) => {
        let media_url = null;
        if (p.media_path) {
          const signed = await db.storage
            .from("announcement-media")
            .createSignedUrl(p.media_path, 3600);
          if (signed.error) throw signed.error;
          media_url = signed.data.signedUrl;
        }
        return {
          ...p,
          media_url,
          comments: (comments.data || []).filter((c) => c.post_id === p.id),
          reactions: (reactions.data || []).filter((v) => v.post_id === p.id),
        };
      }),
    );
    return paymentJson({
      posts,
      user_id: actor.id,
      admin: actor.admin,
      can_publish: canPublish,
    });
  } catch (e) {
    return paymentFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const { db, actor, canPublish } = await context(request);
    if (!canPublish)
      throw new PaymentError(
        "A administração precisa liberar sua publicação no mural.",
        403,
      );
    const body = announcementSchema.parse(await paymentBody(request));
    const { id, ...values } = body;
    let existing: { media_path: string | null } | null = null;
    if (id) {
      const old = await db
        .from("announcements")
        .select("author_id,media_path")
        .eq("id", id)
        .maybeSingle();
      if (old.error) throw old.error;
      if (!old.data) throw new PaymentError("Comunicado não encontrado.", 404);
      if (!actor.admin && old.data.author_id !== actor.id)
        throw new PaymentError(
          "Sem permissão para editar este comunicado.",
          403,
        );
      existing = old.data;
    }
    if (body.media_path && body.media_path !== existing?.media_path) {
      if (!body.media_path.startsWith(actor.id + "/"))
        throw new PaymentError("Imagem inválida.", 403);
      const [folder, name] = body.media_path.split("/");
      const files = await db.storage
        .from("announcement-media")
        .list(folder, { search: name, limit: 1 });
      if (files.error) throw files.error;
      if (!files.data.some((f) => f.name === name))
        throw new PaymentError("Envie a imagem novamente.");
    }
    const result = id
      ? await db.from("announcements").update(values).eq("id", id)
      : await db
          .from("announcements")
          .insert({ ...values, author_id: actor.id, author_name: actor.name });
    if (result.error) throw result.error;
    return paymentJson({ ok: true }, 201);
  } catch (e) {
    return paymentFailure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    const { db, actor } = await context(request);
    const body = announcementAction.parse(await paymentBody(request));
    if (body.action === "permission") {
      if (!actor.admin)
        throw new PaymentError(
          "Apenas administradores podem liberar publicações.",
          403,
        );
      const target = await db
        .from("profiles")
        .select("user_id")
        .eq("user_id", body.user_id)
        .eq("active", true)
        .is("deleted_at", null)
        .maybeSingle();
      if (target.error) throw target.error;
      if (!target.data) throw new PaymentError("Selecione um usuário ativo.");
      const result = body.can_publish
        ? await db
            .from("announcement_publishers")
            .upsert({ user_id: body.user_id, granted_by: actor.id })
        : await db
            .from("announcement_publishers")
            .delete()
            .eq("user_id", body.user_id);
      if (result.error) throw result.error;
    } else if (body.action === "delete_comment") {
      let q = db
        .from("announcement_comments")
        .delete()
        .eq("id", body.comment_id);
      if (!actor.admin) q = q.eq("author_id", actor.id);
      const result = await q;
      if (result.error) throw result.error;
    } else {
      const post = await db
        .from("announcements")
        .select("id,author_id")
        .eq("id", body.post_id)
        .maybeSingle();
      if (post.error) throw post.error;
      if (!post.data) throw new PaymentError("Comunicado não encontrado.", 404);
      if (body.action === "delete_post") {
        if (!actor.admin && post.data.author_id !== actor.id)
          throw new PaymentError(
            "Sem permissão para excluir este comunicado.",
            403,
          );
        const result = await db
          .from("announcements")
          .delete()
          .eq("id", body.post_id);
        if (result.error) throw result.error;
      }
      if (body.action === "comment") {
        const result = await db.from("announcement_comments").insert({
          post_id: body.post_id,
          author_id: actor.id,
          author_name: actor.name,
          body: body.body,
        });
        if (result.error) throw result.error;
      }
      if (body.action === "react") {
        const result = body.reaction
          ? await db.from("announcement_reactions").upsert(
              {
                post_id: body.post_id,
                user_id: actor.id,
                reaction: body.reaction,
              },
              { onConflict: "post_id,user_id" },
            )
          : await db
              .from("announcement_reactions")
              .delete()
              .eq("post_id", body.post_id)
              .eq("user_id", actor.id);
        if (result.error) throw result.error;
      }
    }
    return paymentJson({ ok: true });
  } catch (e) {
    return paymentFailure(e);
  }
}
