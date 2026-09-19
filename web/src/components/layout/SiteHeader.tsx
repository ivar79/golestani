import Image from "next/image";

export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-9 w-9 rounded-xl text-base" : "h-11 w-11 rounded-2xl text-xl";
  const text = size === "sm" ? "text-lg" : "text-xl";
  return (
    <>
      <span
        className={`relative flex ${box} shrink-0 items-center justify-center overflow-hidden bg-navy-800 shadow-lg shadow-navy-800/25`}
      >
        <Image src="/incart-logo.webp" alt="لوگوی اینکارت" fill sizes="44px" className="object-cover" />
      </span>
      <span className={`${text} font-black tracking-tight text-navy-900`}>اینکارت</span>
    </>
  );
}
