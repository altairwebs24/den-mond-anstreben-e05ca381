import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(2000),
  category: z.string().min(2).max(80),
  collection_id: z.string().uuid().nullable(),
  price: z.number().min(0).nullable(),
  images: z.array(z.string().max(1000)).max(12),
  colors: z.array(z.string().max(50)).max(30),
  sizes: z.array(z.string().max(30)).max(30),
  in_stock: z.boolean(),
  featured: z.boolean(),
  published: z.boolean(),
});

type ProductRow = Database["public"]["Tables"]["products"]["Row"];

const attachProductImageUrls = async (client: SupabaseClient<Database>, products: ProductRow[]) =>
  Promise.all(
    products.map(async (product) => {
      const imagePaths = product.images;
      const images = await Promise.all(
        imagePaths.map(async (image) => {
          if (!image.startsWith("product-images/")) return image;
          const { data } = await client.storage
            .from("product-images")
            .createSignedUrl(image.slice("product-images/".length), 60 * 60 * 24);
          return data?.signedUrl ?? "";
        }),
      );
      return { ...product, images: images.filter(Boolean), image_paths: imagePaths };
    }),
  );

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("*")
    .eq("published", true)
    .order("featured", { ascending: false });
  if (error) throw new Error("Could not load the collection.");
  return attachProductImageUrls(supabaseAdmin, data);
});

const requireAdmin = async (context: {
  supabase: SupabaseClient<Database>;
  userId: string;
  claims: Record<string, unknown>;
}) => {
  let { data: role } = await context.supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  const email = typeof context.claims.email === "string" ? context.claims.email.toLowerCase() : "";
  const { getServerConfig } = await import("@/lib/config.server");
  const adminEmails = new Set(getServerConfig().approvedAdminEmails);
  if (!role && adminEmails.has(email)) {
    const result = await context.supabase
      .from("user_roles")
      .upsert({ user_id: context.userId, role: "admin" }, { onConflict: "user_id,role" })
      .select("id")
      .single();
    role = result.data;
  }
  if (!role) throw new Error("This account is not authorised to manage the store.");
};

const adminEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

export const listAdminAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, created_at")
      .eq("role", "admin")
      .order("created_at");
    if (error) throw new Error("Could not load administrators.");
    return Promise.all(
      roles.map(async (role) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(role.user_id);
        return { userId: role.user_id, email: data.user?.email ?? "Unknown account" };
      }),
    );
  });

export const allocateAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminEmailSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let page = 1;
    let targetUserId = "";
    while (!targetUserId) {
      const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error("Could not look up that account.");
      targetUserId = users.users.find((user) => user.email?.toLowerCase() === data.email)?.id ?? "";
      if (targetUserId || users.users.length < 1000) break;
      page += 1;
    }
    if (!targetUserId) {
      throw new Error("That email must create an account before it can be made an admin.");
    }
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: targetUserId, role: "admin" }, { onConflict: "user_id,role" });
    if (error) throw new Error("Could not grant admin access.");
    return { email: data.email };
  });

export const listAdminProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return attachProductImageUrls(context.supabase, data);
  });

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => productSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { id, ...values } = data;
    const result = id
      ? await context.supabase.from("products").update(values).eq("id", id).select().single()
      : await context.supabase.from("products").insert(values).select().single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { error } = await context.supabase.from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listCollections = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("collections")
    .select("*")
    .eq("published", true)
    .order("name");
  if (error) throw new Error("Could not load collections.");
  return data;
});

export const listAdminCollections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase.from("collections").select("*").order("name");
    if (error) throw new Error(error.message);
    return data;
  });

export const saveCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(2).max(80),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        published: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { id, ...values } = data;
    const result = id
      ? await context.supabase.from("collections").update(values).eq("id", id).select().single()
      : await context.supabase.from("collections").insert(values).select().single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const deleteCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { error } = await context.supabase.from("collections").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
