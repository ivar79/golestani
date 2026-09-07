import type { Metadata } from "next";
import SearchPage from "@/app/search/page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const decodedCity = decodeURIComponent(city);
  return {
    title: `کسب‌وکارهای ${decodedCity} | اینکارت`,
    description: `بانک مشاغل و کسب‌وکارهای شهر ${decodedCity}`,
    alternates: { canonical: `/${city}` },
  };
}

export default function CityPage() {
  return <SearchPage />;
}
