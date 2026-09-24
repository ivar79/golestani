import api from "@/lib/api";

export type PublicTaxonomy = {
  id: number;
  type: "city" | "neighborhood" | "category" | "service" | "badge";
  parent_id: number | null;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
};

export async function getPublicTaxonomies(type: PublicTaxonomy["type"], parentId?: number) {
  const params = new URLSearchParams({ type });
  if (parentId) params.set("parent_id", String(parentId));
  return (await api.get<PublicTaxonomy[]>(`/public/taxonomies?${params.toString()}`)).data;
}
