import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes; later values win (shadcn-style convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
