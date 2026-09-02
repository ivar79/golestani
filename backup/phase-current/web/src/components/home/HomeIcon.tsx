export type HomeIconName =
  | "verified" | "contactPage" | "qrScanner" | "search" | "storefront"
  | "badge" | "groups" | "rocket" | "chevron" | "arrowLeft" | "arrowRight"
  | "person" | "share" | "at" | "check" | "phone" | "location" | "qr" | "arrow";

export default function HomeIcon({ name, className = "h-5 w-5", strokeWidth = 1.8 }: { name: HomeIconName; className?: string; strokeWidth?: number }) {
  const p = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "verified": return <svg {...p}><path d="M12 2l2.4 1.8 3-.2 1 2.8 2.4 1.8-.9 2.9.9 2.9-2.4 1.8-1 2.8-3-.2L12 22l-2.4-1.8-3 .2-1-2.8-2.4-1.8.9-2.9-.9-2.9 2.4-1.8 1-2.8 3 .2L12 2z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "contactPage": return <svg {...p}><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M14 2v6h6" /><circle cx="12" cy="11" r="2.5" /><path d="M8 18c.8-2 2.4-3 4-3s3.2 1 4 3" /></svg>;
    case "qrScanner": return <svg {...p}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><rect x="9" y="9" width="6" height="6" rx="0.5" /></svg>;
    case "search": return <svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></svg>;
    case "storefront": return <svg {...p}><path d="M4 9l1.5-4h13L20 9M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M4 9h16M9 20v-5h6v5" /></svg>;
    case "badge": return <svg {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="9" r="2.5" /><path d="M8 16.5c.8-1.8 2.3-2.8 4-2.8s3.2 1 4 2.8" /></svg>;
    case "groups": return <svg {...p}><circle cx="9" cy="9" r="3" /><path d="M3 19c.7-3 3-4.5 6-4.5s5.3 1.5 6 4.5" /><circle cx="17" cy="10" r="2.5" /><path d="M15.8 14.8c2.3.4 4 1.8 4.7 4.2" /></svg>;
    case "rocket": return <svg {...p}><path d="M14 4c3 1 5 3 6 6-2 5-6 8-10 9l-3-3c1-4 4-8 7-12Z" /><circle cx="14.5" cy="9.5" r="1.5" /><path d="M6 15l-2 5 5-2" /></svg>;
    case "chevron": return <svg {...p}><path d="m9 6 6 6-6 6" /></svg>;
    case "arrowLeft": return <svg {...p}><path d="M20 12H4m6-6-6 6 6 6" /></svg>;
    case "arrowRight": return <svg {...p}><path d="M4 12h16m-6-6 6 6-6 6" /></svg>;
    case "person": return <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>;
    case "share": return <svg {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>;
    case "at": return <svg {...p}><circle cx="12" cy="12" r="4" /><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" /></svg>;
    case "check": return <svg {...p}><path d="m5 12 5 5 9-10" /></svg>;
    case "phone": return <svg {...p}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /></svg>;
    case "location": return <svg {...p}><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>;
    case "arrow": return <svg {...p}><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
    case "qr": return <svg {...p}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><rect x="9" y="9" width="6" height="6" rx="0.5" /></svg>;
  }
}
