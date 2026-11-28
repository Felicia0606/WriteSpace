// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const issuer = "https://securetoken.google.com/test-classroom";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
  `);
  const migration = readFileSync(
    resolve(__dirname, "../supabase/migrations/202611270001_peer_review.sql"),
    "utf8",
  );
  // Embedded Postgres does not run Supabase's external Realtime publication service.
  await db.exec(
    migration.replace(
      "alter publication supabase_realtime add table public.peer_review_comments, public.peer_review_reactions;",
      "",
    ),
  );
  await db.exec(`
    insert into public.peer_review_snapshots(id, class_id, group_id, content_hash, text_content)
      values ('00000000-0000-4000-8000-000000000001', 'class', 'group', 'hash', 'An essay');
    insert into public.peer_review_comments(id, class_id, group_id, snapshot_id, author_uid, author_name, body)
      values ('00000000-0000-4000-8000-000000000002', 'class', 'group', '00000000-0000-4000-8000-000000000001', 'other', 'Other student', 'Feedback');
    insert into public.peer_review_reactions(class_id, group_id, author_uid, author_name, emoji)
      values ('class', 'group', 'other', 'Other student', '👍');
  `);
}, 30000);
afterAll(async () => {
  await db?.close();
});

async function identity(sub?: string, iss = issuer, role = "anon") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(sub ? { sub, iss } : {}),
  ]);
  await db.exec(`set role ${role}`);
}
async function grant(uid: string, group = "group") {
  await db.exec("reset role");
  await db.query("select public.peer_review_grant_access($1, $2, $3, $4)", [
    uid,
    issuer,
    "class",
    group,
  ]);
}
async function counts() {
  const result = await db.query<{
    comments: number;
    reactions: number;
    snapshots: number;
  }>(`select
    (select count(*)::integer from public.peer_review_comments) as comments,
    (select count(*)::integer from public.peer_review_reactions) as reactions,
    (select count(*)::integer from public.peer_review_snapshots) as snapshots`);
  return result.rows[0];
}

describe("Supabase Postgres row-level access policies", () => {
  it("denies public keys and users without a server-verified grant", async () => {
    await identity();
    expect(await counts()).toEqual({ comments: 0, reactions: 0, snapshots: 0 });
    await identity("outsider");
    expect(await counts()).toEqual({ comments: 0, reactions: 0, snapshots: 0 });
  });
  it("allows Firebase string UIDs with either anon or authenticated role only after a grant", async () => {
    await grant("firebase-string-uid");
    for (const role of ["anon", "authenticated"]) {
      await identity("firebase-string-uid", issuer, role);
      expect(await counts()).toEqual({
        comments: 1,
        reactions: 1,
        snapshots: 1,
      });
    }
  });
  it("rejects another issuer, another group and expired grants", async () => {
    await identity(
      "firebase-string-uid",
      "https://securetoken.google.com/attacker",
    );
    expect((await counts()).comments).toBe(0);
    await grant("other-group", "different");
    await identity("other-group");
    expect((await counts()).comments).toBe(0);
    await db.exec(
      "reset role; update peer_review_private.access_grants set expires_at = now() - interval '1 second'",
    );
    await identity("firebase-string-uid");
    expect((await counts()).comments).toBe(0);
  });
  it("does not let browsers mint grants, read grant records or mutate feedback", async () => {
    await grant("student");
    await identity("student");
    await expect(
      db.query("select public.peer_review_grant_access($1, $2, $3, $4)", [
        "student",
        issuer,
        "class",
        "group",
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select * from peer_review_private.access_grants"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec("update public.peer_review_comments set body = 'Tampered'"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec("delete from public.peer_review_reactions"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec(
        "insert into public.peer_review_reactions(class_id,group_id,author_uid,author_name,emoji) values ('class','group','student','Fake','👍')",
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec(
        "update public.peer_review_snapshots set text_content = 'Edited essay'",
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("rejects duplicate reactions and comments attached to an unrelated snapshot", async () => {
    await db.exec("reset role");
    await expect(
      db.exec(
        "insert into public.peer_review_reactions(class_id,group_id,author_uid,author_name,emoji) values ('class','group','other','Other student','👍')",
      ),
    ).rejects.toThrow(/unique constraint/);
    await expect(
      db.exec(`insert into public.peer_review_comments(id,class_id,group_id,snapshot_id,author_uid,author_name,body)
      values ('00000000-0000-4000-8000-000000000003','other-class','group','00000000-0000-4000-8000-000000000001','student','Sam','Wrong class')`),
    ).rejects.toThrow(/foreign key constraint/);
  });
});
