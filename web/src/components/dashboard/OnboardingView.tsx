import { Store, Palette, PenTool, ArrowLeft } from "lucide-react";

export function OnboardingView({ onSelect }: { onSelect: (path: number) => void }) {
  return (
    <div dir="rtl" className="min-h-screen bg-[#050b14] flex flex-col items-center justify-center p-6 text-slate-100 font-sans selection:bg-[#00c98d]/20">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-16">
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-4">به اینکارت خوش آمدید</h1>
          <p className="text-slate-400 text-lg">برای شروع، مسیر ثبت کسب‌وکار خود را انتخاب کنید.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Path 1 */}
          <div 
            onClick={() => onSelect(1)}
            className="group cursor-pointer bg-[#081322] border border-[#13243a] rounded-3xl p-8 hover:border-[#00c98d]/50 hover:bg-[#0a1a2e] transition-all flex flex-col h-full"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#0e3b33] text-[#00c98d] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Store className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-white mb-3">کارت ویزیت دارم</h2>
            <p className="text-sm text-slate-400 leading-relaxed mb-8 flex-1">
              تصویر کارت ویزیت فعلی خود را آپلود کنید و صفحه اختصاصی خود را بسازید.
            </p>
            <div className="flex items-center text-[#00c98d] text-sm font-bold gap-2">
              <span>انتخاب این مسیر</span>
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            </div>
          </div>

          {/* Path 2 */}
          <div 
            onClick={() => onSelect(2)}
            className="group cursor-pointer bg-[#081322] border border-[#13243a] rounded-3xl p-8 hover:border-[#3b82f6]/50 hover:bg-[#0a1a2e] transition-all flex flex-col h-full"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#1e3a8a]/40 text-[#3b82f6] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Palette className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-white mb-3">کارت را خودم می‌سازم</h2>
            <p className="text-sm text-slate-400 leading-relaxed mb-8 flex-1">
              با استفاده از قالب‌های آماده، کارت ویزیت دیجیتال خود را به راحتی طراحی کنید.
            </p>
            <div className="flex items-center text-[#3b82f6] text-sm font-bold gap-2">
              <span>انتخاب این مسیر</span>
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            </div>
          </div>

          {/* Path 3 */}
          <div 
            onClick={() => onSelect(3)}
            className="group cursor-pointer bg-[#081322] border border-[#13243a] rounded-3xl p-8 hover:border-[#a855f7]/50 hover:bg-[#0a1a2e] transition-all flex flex-col h-full"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#581c87]/40 text-[#a855f7] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <PenTool className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-white mb-3">سفارش طراحی اختصاصی</h2>
            <p className="text-sm text-slate-400 leading-relaxed mb-8 flex-1">
              طراحی کارت ویزیت خود را به طراحان حرفه‌ای ما بسپارید تا بهترین نتیجه را بگیرید.
            </p>
            <div className="flex items-center text-[#a855f7] text-sm font-bold gap-2">
              <span>انتخاب این مسیر</span>
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
