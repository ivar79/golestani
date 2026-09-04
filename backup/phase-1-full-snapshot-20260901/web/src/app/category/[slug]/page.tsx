import type { Metadata } from "next";
import SearchPage from "@/app/search/page";
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{const {slug}=await params;return {title:`کسب‌وکارهای ${slug} | اینکارت`,description:`جست‌وجوی کسب‌وکارهای دسته ${slug}`,alternates:{canonical:`/category/${slug}`}}}
export default function CategoryPage(){return <SearchPage/>}
