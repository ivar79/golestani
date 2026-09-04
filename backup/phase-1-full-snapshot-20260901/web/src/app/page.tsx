import HomeCta from "@/components/home/HomeCta";
import HomeFeatures from "@/components/home/HomeFeatures";
import HomeFooter from "@/components/home/HomeFooter";
import HomeHeader from "@/components/home/HomeHeader";
import HomeHero from "@/components/home/HomeHero";
import HomeSearch from "@/components/home/HomeSearch";
import HomeShowcase from "@/components/home/HomeShowcase";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-night text-surface">
      <HomeHeader />
      <HomeHero />
      <HomeFeatures />
      <HomeSearch />
      <HomeShowcase />
      <HomeCta />
      <HomeFooter />
    </main>
  );
}
