import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SearchPage from "@/app/search/page";
import { isValidLocation } from "@/lib/iranGeo";

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params;
  if (!isValidLocation(city)) notFound();
  
  const decodedCity = decodeURIComponent(city);
  return {
    title: `کسب‌وکارهای ${decodedCity} | اینکارت`,
    description: `بانک مشاغل و کسب‌وکارهای شهر ${decodedCity}`,
    alternates: { canonical: `/${city}` },
  };
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  if (!isValidLocation(city)) notFound();
  return <SearchPage />;
}
