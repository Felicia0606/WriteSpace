import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  ReviewError,
  reviewPermission,
  validateAnchor,
  type GroupRecord,
} from "./policy.ts";

const project = Deno.env.get("FIREBASE_PROJECT_ID");
const issuer = `https://securetoken.google.com/${project}`;
const keys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
  nullValue?: null;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};
function decode(value: FirestoreValue): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("booleanValue" in value) return value.booleanValue;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decode);
  if (value.mapValue)
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([key, val]) => [
        key,
        decode(val),
      ]),
    );
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { headers: cors });
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  try {
    if (!project)
      throw new ReviewError(
        "Peer feedback has not been configured by the administrator.",
        503,
      );
    const token = request.headers
      .get("Authorization")
      ?.match(/^Bearer (.+)$/)?.[1];
    if (!token)
      throw new ReviewError("Please sign in to open peer feedback.", 401);
    let uid: string;
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: project,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "iat"],
      });
      if (!payload.sub || payload.sub.length > 128)
        throw new Error("Invalid subject");
      uid = payload.sub;
    } catch {
      throw new ReviewError(
        "Your session has expired. Please sign in again.",
        401,
      );
    }
    const raw = await request.text();
    if (raw.length > 500000)
      throw new ReviewError("This request is too large.", 413);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new ReviewError("Invalid request.", 400);
    }
    if (!input || typeof input !== "object")
      throw new ReviewError("Invalid request.", 400);
    const { classId, groupId, action } = input;
    const validId = (id: unknown): id is string =>
      typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
    if (
      !validId(classId) ||
      !validId(groupId) ||
      !["open", "comment", "reaction"].includes(String(action))
    )
      throw new ReviewError("Invalid review request.", 400);

    async function read<T>(path: string): Promise<T> {
      // User's token enforces the EXISTING Firestore rules; never bypass them.
      const result = await fetch(
        `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!result.ok)
        throw new ReviewError(
          "This classroom or essay is not available to your account.",
          result.status === 401 ? 401 : 403,
        );
      const doc = await result.json();
      return Object.fromEntries(
        Object.entries(doc.fields ?? {}).map(([key, value]) => [
          key,
          decode(value as FirestoreValue),
        ]),
      ) as T;
    }
    const cls = await read<{ teacherId: string }>(`classes/${classId}`);
    const [target, essay] = await Promise.all([
      read<GroupRecord>(`classes/${classId}/groups/${groupId}`),
      read<{ classId: string; status: string; textContent?: string }>(
        `documents/${groupId}`,
      ),
    ]);
    let student: { groupId: string; name: string } | null = null;
    let own: GroupRecord | null = null;
    let ownStatus: string | undefined;
    if (uid !== cls.teacherId) {
      student = await read<{ groupId: string; name: string }>(
        `classes/${classId}/students/${encodeURIComponent(uid)}`,
      );
      if (!validId(student.groupId))
        throw new ReviewError("Join a writing group before reviewing.");
      own = await read(`classes/${classId}/groups/${student.groupId}`);
      ownStatus = (
        await read<{ status: string }>(`documents/${student.groupId}`)
      ).status;
    }
    const permission = reviewPermission(
      uid,
      cls.teacherId,
      classId,
      groupId,
      target,
      essay,
      student,
      own,
      ownStatus,
    );
    if (action !== "open" && !permission.canWrite)
      throw new ReviewError(
        "You can only leave peer feedback on another group’s submitted essay.",
      );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const text = essay.textContent ?? "";
    if (text.length > 200000)
      throw new ReviewError("This essay is too long for peer feedback.", 400);
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { error: snapshotError } = await admin
      .from("peer_review_snapshots")
      .upsert(
        {
          class_id: classId,
          group_id: groupId,
          content_hash: hash,
          text_content: text,
        },
        {
          onConflict: "class_id,group_id,content_hash",
          ignoreDuplicates: true,
        },
      );
    if (snapshotError) throw snapshotError;
    const { data: snapshot, error: lookupError } = await admin
      .from("peer_review_snapshots")
      .select("id,text_content")
      .eq("class_id", classId)
      .eq("group_id", groupId)
      .eq("content_hash", hash)
      .single();
    if (lookupError) throw lookupError;

    if (action === "comment") {
      if (input.snapshotId !== snapshot.id)
        throw new ReviewError(
          "The essay changed. Refresh it and select the passage again.",
          409,
        );
      if (
        typeof input.body !== "string" ||
        !input.body.trim() ||
        input.body.length > 2000 ||
        typeof input.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          input.id,
        )
      )
        throw new ReviewError(
          "Enter a comment of up to 2,000 characters.",
          400,
        );
      const anchor = validateAnchor(text, input.anchor);
      const { error } = await admin
        .from("peer_review_comments")
        .insert({
          id: input.id,
          class_id: classId,
          group_id: groupId,
          snapshot_id: snapshot.id,
          author_uid: uid,
          author_name: permission.authorName,
          body: input.body.trim(),
          selection_start: anchor?.start ?? null,
          selection_end: anchor?.end ?? null,
          quote: anchor?.quote ?? null,
        });
      if (error) {
        // A retry after a lost network response must not duplicate the comment.
        const { data: existing } = await admin
          .from("peer_review_comments")
          .select(
            "author_uid,class_id,group_id,body,snapshot_id,selection_start,selection_end,quote",
          )
          .eq("id", input.id)
          .maybeSingle();
        if (
          error.code !== "23505" ||
          !existing ||
          existing.author_uid !== uid ||
          existing.class_id !== classId ||
          existing.group_id !== groupId ||
          existing.body !== input.body.trim() ||
          existing.snapshot_id !== snapshot.id ||
          existing.selection_start !== (anchor?.start ?? null) ||
          existing.selection_end !== (anchor?.end ?? null) ||
          existing.quote !== (anchor?.quote ?? null)
        )
          throw error;
      }
    }
    if (action === "reaction") {
      if (
        !["👍", "❤️", "💡", "👏", "🎉"].includes(String(input.emoji)) ||
        typeof input.active !== "boolean"
      )
        throw new ReviewError("Choose a valid reaction.", 400);
      const { error } = await admin
        .from("peer_review_reactions")
        .upsert(
          {
            class_id: classId,
            group_id: groupId,
            author_uid: uid,
            author_name: permission.authorName,
            emoji: input.emoji,
            active: input.active,
          },
          { onConflict: "class_id,group_id,author_uid,emoji" },
        );
      if (error) throw error;
    }
    const { error: grantError } = await admin.rpc("peer_review_grant_access", {
      p_uid: uid,
      p_issuer: issuer,
      p_class: classId,
      p_group: groupId,
    });
    if (grantError) throw grantError;
    return json({ snapshot, canWrite: permission.canWrite });
  } catch (error) {
    if (error instanceof ReviewError)
      return json({ error: error.message }, error.status);
    console.error(
      "Peer review operation failed",
      error instanceof Error ? error.name : "Database error",
    );
    return json(
      {
        error:
          "Peer feedback could not be loaded or saved. Please retry or contact your teacher.",
      },
      500,
    );
  }
});
