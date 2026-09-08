import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SearchPage from "@/app/search/page";
import { isValidLocation } from "@/lib/iranGeo";

export async function generateMetadata({ params }: { params: Promise<{ city: string; category: string }> }): Promise<Metadata> {
  const p = await params;
  if (!isValidLocation(p.city)) notFound();
  
  return {
    title: `${decodeURIComponent(p.category)} در ${decodeURIComponent(p.city)} | اینکارت`,
    description: `کسب‌وکارهای ${decodeURIComponent(p.category)} در ${decodeURIComponent(p.city)}`,
    alternates: { canonical: `/${p.city}/${p.category}` }
  };
}

export default async function CityCategoryPage({ params }: { params: Promise<{ city: string; category: string }> }) {
  const p = await params;
  if (!isValidLocation(p.city)) notFound();
  return <SearchPage />;
}
