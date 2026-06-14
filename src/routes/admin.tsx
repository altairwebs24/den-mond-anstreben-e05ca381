import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ImagePlus, Loader2, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteCollection,
  deleteProduct,
  listAdminCollections,
  listAdminProducts,
  saveCollection,
  saveProduct,
} from "@/lib/products.functions";
import { money, splitList, type Product } from "@/lib/products";

export const Route = createFileRoute("/admin")({ ssr: false, component: AdminPage });
const empty = {
  name: "",
  slug: "",
  description: "",
  category: "T-Shirts",
  collection_id: "",
  price: "",
  images: "",
  colors: "",
  sizes: "S, M, L, XL",
  in_stock: true,
  featured: false,
  published: false,
};
function AdminPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth" });
      else setReady(true);
    });
  }, [navigate]);
  const query = useQuery({
    queryKey: ["admin-products"],
    queryFn: () => listAdminProducts(),
    enabled: ready,
    retry: false,
  });
  const collections = useQuery({
    queryKey: ["admin-collections"],
    queryFn: () => listAdminCollections(),
    enabled: ready,
    retry: false,
  });
  const [collectionName, setCollectionName] = useState("");
  const collectionSave = useMutation({
    mutationFn: () =>
      saveCollection({
        data: {
          name: collectionName,
          slug: collectionName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
          published: true,
        },
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-collections"] });
      setCollectionName("");
      setMessage("Collection created.");
    },
    onError: (error) => setMessage(error.message),
  });
  const save = useMutation({
    mutationFn: () =>
      saveProduct({
        data: {
          id: editing,
          name: form.name,
          slug: form.slug,
          description: form.description,
          category: form.category,
          collection_id: form.collection_id || null,
          price: form.price ? Number(form.price) : null,
          images: splitList(form.images),
          colors: splitList(form.colors),
          sizes: splitList(form.sizes),
          in_stock: form.in_stock,
          featured: form.featured,
          published: form.published,
        },
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-products"] });
      setForm(empty);
      setEditing(undefined);
      setMessage("Product saved.");
    },
    onError: (error) => setMessage(error.message),
  });
  const edit = (p: Product) => {
    setEditing(p.id);
    setForm({
      name: p.name,
      slug: p.slug,
      description: p.description,
      category: p.category,
      collection_id: p.collection_id ?? "",
      price: p.price?.toString() ?? "",
      images: ((p as Product & { image_paths?: string[] }).image_paths ?? p.images).join(", "),
      colors: p.colors.join(", "),
      sizes: p.sizes.join(", "),
      in_stock: p.in_stock,
      featured: p.featured,
      published: p.published,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setMessage("");
    try {
      const uploaded: string[] = [];
      const previews: Record<string, string> = {};
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image.`);
        if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB.`);
        const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `products/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (error) throw error;
        const storedPath = `product-images/${path}`;
        uploaded.push(storedPath);
        previews[storedPath] = URL.createObjectURL(file);
      }
      setForm((current) => ({
        ...current,
        images: [...splitList(current.images), ...uploaded].join(", "),
      }));
      setImagePreviews((current) => ({ ...current, ...previews }));
      setMessage(`${uploaded.length} image${uploaded.length === 1 ? "" : "s"} uploaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  };
  if (!ready) return <div className="p-12">Checking access…</div>;
  if (query.error)
    return (
      <div className="mx-auto max-w-xl px-4 py-20">
        <h1 className="font-display text-4xl uppercase">Admin access required</h1>
        <p className="mt-4 text-muted-foreground">
          Sign in with an approved Den Mond admin account to manage this store.
        </p>
        <Button
          className="mt-6"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/auth" });
          }}
        >
          Use another account
        </Button>
      </div>
    );
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[.3em] text-primary">
            Den Mond backend
          </p>
          <h1 className="font-display mt-2 text-4xl font-black uppercase sm:text-6xl">
            Manage products
          </h1>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={async () => {
            await client.cancelQueries();
            client.clear();
            await supabase.auth.signOut();
            navigate({ to: "/auth", replace: true });
          }}
        >
          <LogOut />
        </Button>
      </div>
      <section className="mt-10 border border-border bg-card p-5 sm:p-8">
        <h2 className="font-display text-2xl font-black uppercase">Collections</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Create groups such as Tees, Caps, Tops, or Pants, then assign products below.
        </p>
        <div className="mt-5 flex gap-3">
          <Input
            placeholder="Collection name"
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
          />
          <Button
            disabled={collectionSave.isPending || collectionName.trim().length < 2}
            onClick={() => collectionSave.mutate()}
          >
            <Plus /> Add
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {collections.data?.map((collection) => (
            <div
              key={collection.id}
              className="flex items-center gap-1 border border-border px-3 py-2 text-sm font-bold uppercase"
            >
              <span>{collection.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={`Delete ${collection.name}`}
                onClick={async () => {
                  if (!window.confirm(`Delete ${collection.name}? Products will remain available.`))
                    return;
                  await deleteCollection({ data: { id: collection.id } });
                  client.invalidateQueries({ queryKey: ["admin-collections"] });
                }}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-8 border border-border bg-card p-5 sm:p-8">
        <div className="flex justify-between">
          <h2 className="font-display text-2xl font-black uppercase">
            {editing ? "Edit product" : "New product"}
          </h2>
          {editing && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setEditing(undefined);
                setForm(empty);
              }}
            >
              <X />
            </Button>
          )}
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Product name">
            <Input
              value={form.name}
              maxLength={120}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                  slug: editing
                    ? form.slug
                    : e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, ""),
                })
              }
            />
          </Field>
          <Field label="URL slug">
            <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </Field>
          <Field label="Collection">
            <Select
              value={form.collection_id || "none"}
              onValueChange={(value) =>
                setForm({ ...form, collection_id: value === "none" ? "" : value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose collection" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No collection</SelectItem>
                {collections.data?.map((collection) => (
                  <SelectItem key={collection.id} value={collection.id}>
                    {collection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category label">
            <Input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </Field>
          <Field label="Price (ZAR)">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Field>
          <Field label="Description" wide>
            <Textarea
              className="min-h-28"
              value={form.description}
              maxLength={2000}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="Product images" wide>
            <div className="border border-dashed border-border bg-muted/30 p-5">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 py-5 text-center">
                {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                <span className="font-bold uppercase">
                  {uploading ? "Uploading images…" : "Choose images to upload"}
                </span>
                <span className="text-xs text-muted-foreground">JPG, PNG or WebP · up to 8 MB each</span>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => uploadImages(event.target.files)}
                />
              </label>
              {splitList(form.images).length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {splitList(form.images).map((path, index) => {
                    const existingProduct = query.data?.find((product) => product.id === editing);
                    const existingPaths = (existingProduct as (Product & { image_paths?: string[] }) | undefined)?.image_paths;
                    const existingIndex = existingPaths?.indexOf(path) ?? -1;
                    const preview = imagePreviews[path] || (existingIndex >= 0 ? existingProduct?.images[existingIndex] : path);
                    return (
                      <div key={path} className="relative aspect-square overflow-hidden bg-muted">
                        <img src={preview} alt={`Product upload ${index + 1}`} className="h-full w-full object-cover" />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute right-1 top-1 h-7 w-7"
                          aria-label={`Remove image ${index + 1}`}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              images: splitList(current.images).filter((item) => item !== path).join(", "),
                            }))
                          }
                        >
                          <X />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Field>
          <Field label="Colours — separate with commas">
            <Input
              value={form.colors}
              onChange={(e) => setForm({ ...form, colors: e.target.value })}
            />
          </Field>
          <Field label="Sizes — separate with commas">
            <Input
              value={form.sizes}
              onChange={(e) => setForm({ ...form, sizes: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap gap-5">
          {(["in_stock", "featured", "published"] as const).map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm font-bold uppercase">
              <input
                type="checkbox"
                checked={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
              />
              {key.replace("_", " ")}
            </label>
          ))}
        </div>
        <Button
          className="mt-7 h-12 rounded-none px-8"
          disabled={save.isPending || uploading || !form.name || !form.slug}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            "Saving…"
          ) : (
            <>
              <Plus /> Save product
            </>
          )}
        </Button>
        {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
      </section>
      <section className="mt-12">
        <h2 className="font-display text-3xl font-black uppercase">
          Catalog ({query.data?.length ?? 0})
        </h2>
        <div className="mt-6 divide-y divide-border border-y border-border">
          {query.data?.map((p) => (
            <article
              key={p.id}
              className="grid grid-cols-[72px_1fr] gap-4 py-5 sm:grid-cols-[96px_1fr_auto]"
            >
              <div className="bg-muted">
                {p.images[0] && (
                  <img
                    src={p.images[0]}
                    alt=""
                    className="aspect-square h-full w-full object-cover"
                  />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-lg font-black uppercase">{p.name}</h3>
                  <span
                    className={`px-2 py-1 text-[10px] font-bold uppercase ${p.published ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    {p.published ? "Live" : "Draft"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {p.category} · {money(p.price)}
                </p>
              </div>
              <div className="col-span-2 flex gap-2 sm:col-span-1">
                <Button variant="outline" size="sm" onClick={() => edit(p)}>
                  <Pencil /> Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    if (!window.confirm(`Delete ${p.name}?`)) return;
                    await deleteProduct({ data: { id: p.id } });
                    client.invalidateQueries({ queryKey: ["admin-products"] });
                  }}
                >
                  <Trash2 /> Delete
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "sm:col-span-2" : ""}>
      <span className="mb-2 block text-xs font-black uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}
