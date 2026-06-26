"use client";

import { useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrashIcon } from "@phosphor-icons/react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Article {
  id: string;
  title: string;
  slug: string;
  category: string;
  body: unknown;
  isPublished: boolean;
  publishedAt: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  authorId: string;
}

export default function AdminHelpCenterPage() {
  const { data, isLoading, mutate } = useSWR("/api/admin/support/help", fetcher);
  const articles: Article[] = data?.articles ?? [];

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Article | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openNew() {
    setTitle(""); setSlug(""); setCategory(""); setBodyText(""); setIsPublished(false);
    setFormError("");
    setEditing(null);
    setShowNew(true);
  }

  function openEdit(article: Article) {
    setTitle(article.title);
    setSlug(article.slug);
    setCategory(article.category);
    setBodyText(typeof article.body === "string" ? article.body : JSON.stringify(article.body, null, 2));
    setIsPublished(article.isPublished);
    setFormError("");
    setEditing(article);
    setShowNew(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const body = { title, slug: slug || undefined, category, body: bodyText, isPublished };
      let res: Response;
      if (editing) {
        res = await fetch(`/api/admin/support/help/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/admin/support/help", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      const json = await res.json();
      if (!res.ok) { setFormError(json.error ?? "Save failed"); return; }
      setShowNew(false);
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(id: string, articleTitle: string) {
    setDeleteTarget({ id, title: articleTitle });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    await fetch(`/api/admin/support/help/${deleteTarget.id}`, { method: "DELETE" });
    setDeleting(false);
    setDeleteTarget(null);
    await mutate();
  }

  async function handleTogglePublish(article: Article) {
    await fetch(`/api/admin/support/help/${article.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublished: !article.isPublished }),
    });
    await mutate();
  }

  // Group articles by category
  const grouped: Record<string, Article[]> = {};
  for (const a of articles) {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Help Center</h1>
          <p className="text-muted-foreground text-sm mt-1">{articles.length} article{articles.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={openNew}>New Article</Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : articles.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          No help articles yet. Create the first one.
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{cat}</h2>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Title</th>
                      <th className="text-left px-4 py-2 font-medium">Slug</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                      <th className="text-left px-4 py-2 font-medium">Updated</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-2 font-medium">{a.title}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{a.slug}</td>
                        <td className="px-4 py-2">
                          <Badge variant={a.isPublished ? "default" : "outline"}>
                            {a.isPublished ? "Published" : "Draft"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{new Date(a.updatedAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2 justify-end">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(a)}>Edit</Button>
                            <Button size="sm" variant="ghost" onClick={() => handleTogglePublish(a)}>
                              {a.isPublished ? "Unpublish" : "Publish"}
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(a.id, a.title)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-xs text-center">
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <TrashIcon className="size-6 text-destructive" weight="fill" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">Delete Article</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Delete &ldquo;{deleteTarget?.title}&rdquo;? This cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create / Edit dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Article" : "New Help Article"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="slug">Slug (optional)</Label>
                <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated from title" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="category">Category</Label>
                <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Getting Started" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Content (plain text or JSON)</Label>
              <Textarea
                id="body"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={10}
                placeholder="Article content…"
                required
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="published"
                checked={isPublished}
                onCheckedChange={setIsPublished}
              />
              <Label htmlFor="published">Published (visible to all users)</Label>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Article"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
