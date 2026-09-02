export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-9 w-9 rounded-xl text-base" : "h-11 w-11 rounded-2xl text-xl";
  const text = size === "sm" ? "text-lg" : "text-xl";
  return (
    <>
      <span
        className={`flex ${box} items-center justify-center bg-navy-800 font-black text-white shadow-lg shadow-navy-800/25`}
      >
        اَ
      </span>
      <span className={`${text} font-black tracking-tight text-navy-900`}>اینکارت</span>
    </>
  );
}
