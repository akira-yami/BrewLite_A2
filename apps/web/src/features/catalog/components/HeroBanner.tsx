'use client';

import Image from 'next/image';
import { InstallButton } from '@/features/pwa/InstallButton';

interface HeroBannerProps {
  onExploreClick?: () => void;
}

export const HeroBanner = ({ onExploreClick }: HeroBannerProps) => {
  return (
    <div className="space-y-3.5">
      {/* Khối Hero Banner chính - Đảm bảo overflow-hidden để bo tròn không bị lỗi */}
      <section className="relative overflow-hidden rounded-[2.25rem] bg-[#153D2C] text-white shadow-xl">
        
        {/* 1. NỀN PHẢI: Ảnh ly nước trên bàn gỗ */}
        <div className="absolute inset-0">
          <Image
            src="/hero-coffee.png"
            alt="Cà phê và trà mộc BrewLite"
            fill
            priority
            className="object-cover object-right lg:object-center"
            sizes="(max-width: 1024px) 100vw, 1200px"
          />
        </div>

        {/* 2. Mảng xanh rêu cắt chéo một đường duy nhất có bóng đổ sang phải
            - overflow-hidden bên trong để tránh lòi góc xanh ra ngoài khi bo tròn */}
        <div 
          className="absolute inset-0 hidden lg:block pointer-events-none overflow-hidden rounded-[2.25rem]"
          style={{
            filter: 'drop-shadow(20px 0 25px rgba(0, 0, 0, 0.65))',
          }}
        >
          <div
            className="h-full w-full bg-[#153D2C]"
            style={{
              // Cắt chéo từ 52% ở đỉnh xuống 40% ở đáy
              clipPath: 'polygon(0 0, 52% 0, 40% 100%, 0 100%)',
            }}
          />
        </div>

        {/* 3. ẢNH HỌA TIẾT CÀNH CÀ PHÊ (Đã chỉnh sát lên mép top để cành mọc từ viền xuống) */}
        <div className="pointer-events-none absolute left-[28%] top-0 z-20 hidden h-72 w-72 -translate-x-1/4 -translate-y-4 opacity-40 lg:block">
          <Image
            src="/coffee-branch.png" // File ảnh cành cây
            alt=""
            fill
            className="object-contain object-top filter invert sepia brightness-150 contrast-125 scale-110"
          />
        </div>

        {/* Lớp phủ chuyển màu cho mobile/tablet */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#153D2C] via-[#153D2C]/90 to-transparent lg:hidden" />

        {/* 4. NỘI DUNG CHỮ & NÚT BẤM */}
        <div className="relative z-10 grid min-h-[380px] grid-cols-1 items-stretch lg:grid-cols-12">
          <div className="flex flex-col justify-center space-y-5 p-8 sm:p-10 lg:col-span-5 lg:p-12">
            
            <div className="inline-flex items-center gap-2.5 text-[10px] font-bold tracking-[0.22em] text-[#C2DBC7] uppercase">
              <span className="h-px w-6 bg-[#C2DBC7]/70" />
              <span>HẠT MỘC CẦU ĐẤT</span>
              <span className="h-px w-6 bg-[#C2DBC7]/70" />
            </div>

            <div className="space-y-1">
              <h2 className="font-serif text-3xl font-black leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-[2.85rem]">
                Ly nước đắng <br />
                từ gốc,
              </h2>
              <div className="font-serif text-2xl font-normal italic tracking-wide text-[#E7D6B9] sm:text-3xl lg:text-[2.35rem]">
                cuộc đời ngọt tại tâm.
              </div>
            </div>

            <p className="max-w-sm text-xs font-light leading-relaxed text-[#C4D9C8] sm:text-sm">
              Cà phê rang mộc và trà thơm mỗi ngày. <br className="hidden sm:block" />
              Một chút ấm áp cho ngày của bạn.
            </p>

            <div className="flex items-center gap-6 pt-2">
              <button
                type="button"
                onClick={onExploreClick}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-bold text-[#C59B27] shadow-md transition hover:bg-[#F3EDE3] active:scale-95"
              >
                <span>Khám phá thực đơn</span>
                <span className="text-sm">→</span>
              </button>

              <button
                type="button"
                className="text-xs font-medium text-white/90 underline decoration-white/40 underline-offset-4 transition hover:text-white"
              >
                Câu chuyện BrewLite
              </button>
            </div>
          </div>
        </div>

        {/* 5. BADGE GÓC PHẢI DƯỚI */}
        <div className="absolute right-5 bottom-4 z-20 flex items-center gap-1.5 rounded-full border border-black/10 bg-white/95 px-3.5 py-1 text-[11px] font-bold text-[#1C1712] shadow-lg backdrop-blur-sm">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-[#7C3A1D]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <ellipse cx="12" cy="12" rx="6.5" ry="9" transform="rotate(-30 12 12)" />
            <path d="M9.5 5.5C11 9 9 14.5 14.5 18.5" />
          </svg>
          <span>Rang mộc · Pha tươi mỗi ngày</span>
        </div>
      </section>

      <InstallButton />

{/* 3 Cam kết chất lượng bên dưới */}
      <div className="grid grid-cols-1 border-b border-[#E8DFC8] py-3 sm:grid-cols-3 sm:py-3.5">
        
        {/* 1. Hạt mộc Cầu Đất - Icon Hạt Cà Phê */}
        <div className="flex items-center gap-3.5 py-1 sm:border-r sm:border-[#E8DFC8] sm:py-0 sm:pr-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EFE6D8]">
            <svg 
              className="h-5 w-5 text-[#7C3A1D]" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="1.8" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              {/* Hình hạt cà phê với đường rãnh lượn sóng ở giữa */}
              <ellipse cx="12" cy="12" rx="6.5" ry="9" transform="rotate(-30 12 12)" />
              <path d="M9.5 5.5C11 9 9 14.5 14.5 18.5" />
            </svg>
          </div>
          <div className="space-y-0.5">
            <h4 className="font-serif text-sm font-bold text-[#1A1612]">Hạt mộc Cầu Đất</h4>
            <p className="text-xs font-medium leading-snug text-[#332A24]">
              Chất lượng từ cao nguyên, hương vị thuần khiết.
            </p>
          </div>
        </div>

        {/* 2. Pha tươi tại quầy - Icon Tách Cà Phê Nóng Bốc Khói */}
        <div className="flex items-center gap-3.5 py-1 sm:border-r sm:border-[#E8DFC8] sm:py-0 sm:px-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EFE6D8]">
            <svg 
              className="h-5 w-5 text-[#7C3A1D]" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="1.8" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              {/* 2 làn khói phía trên */}
              <path d="M7.5 3v2.5" />
              <path d="M11.5 3v2.5" />
              {/* Thân ly và quai tách */}
              <path d="M4 8.5h11a.5.5 0 0 1 .5.5v3.5a6 6 0 0 1-6 6h0a6 6 0 0 1-6-6V9a.5.5 0 0 1 .5-.5z" />
              <path d="M15.5 10.5h1.75a2.25 2.25 0 0 1 0 4.5H14" />
              {/* Đĩa lót dưới */}
              <path d="M3 20.5h13" />
            </svg>
          </div>
          <div className="space-y-0.5">
            <h4 className="font-serif text-sm font-bold text-[#1A1612]">Pha tươi tại quầy</h4>
            <p className="text-xs font-medium leading-snug text-[#332A24]">
              Mỗi ly đều được chuẩn bị cẩn thận.
            </p>
          </div>
        </div>

        {/* 3. Trà thơm tuyển chọn - Icon Chiếc Lá Trà */}
        <div className="flex items-center gap-3.5 py-1 sm:py-0 sm:pl-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EFE6D8]">
            <svg 
              className="h-5 w-5 text-[#7C3A1D]" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="1.8" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              {/* Hình chiếc lá và gân lá */}
              <path d="M6 18c0-7 6-12 13-13-1 7-6 13-13 13z" />
              <path d="M6 18c2-2 5.5-5 9-7" />
              <path d="M6 18c-1.5 1.5-2 3-2 3" />
            </svg>
          </div>
          <div className="space-y-0.5">
            <h4 className="font-serif text-sm font-bold text-[#1A1612]">Trà thơm tuyển chọn</h4>
            <p className="text-xs font-medium leading-snug text-[#332A24]">
              Thanh mát, dịu nhẹ, trọn hương.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};
