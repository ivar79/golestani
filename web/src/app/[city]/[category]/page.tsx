import type { Metadata } from "next";
import SearchPage from "@/app/search/page";
export async function generateMetadata({params}:{params:Promise<{city:string;category:string}>}):Promise<Metadata>{const p=await params;return {title:`${p.category} در ${p.city} | اینکارت`,description:`کسب‌وکارهای ${p.category} در ${p.city}`,alternates:{canonical:`/${p.city}/${p.category}`}}}
export default function CityCategoryPage(){return <SearchPage/>}
