import React, { useId, useState } from 'react';

const hachihiLogoImg = new URL(
  '../assets/images/hachihi_network_logo_1794885219674.jpg',
  import.meta.url
).href;

interface HachihiLogoProps {
  size?: number;
  variant?: 'auto' | 'light' | 'dark';
  showWordmark?: boolean;
  className?: string;
}

const SIZE_CLASS_MAP: Record<number, string> = {
  16: 'w-4 h-4 rounded-[4px]',
  18: 'w-[18px] h-[18px] rounded-[4px]',
  20: 'w-5 h-5 rounded-[5px]',
  22: 'w-[22px] h-[22px] rounded-[5px]',
  24: 'w-6 h-6 rounded-md',
  28: 'w-7 h-7 rounded-md',
  32: 'w-8 h-8 rounded-lg',
  36: 'w-9 h-9 rounded-lg',
  40: 'w-10 h-10 rounded-xl',
  42: 'w-[42px] h-[42px] rounded-xl',
  48: 'w-12 h-12 rounded-xl',
  56: 'w-14 h-14 rounded-2xl',
  64: 'w-16 h-16 rounded-2xl'
};

function resolveSizeClass(size: number): string {
  if (SIZE_CLASS_MAP[size]) return SIZE_CLASS_MAP[size];
  const entries = Object.keys(SIZE_CLASS_MAP).map(Number);
  const closest = entries.reduce((prev, curr) =>
    Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev
  );
  return SIZE_CLASS_MAP[closest];
}

export const HachihiLogo: React.FC<HachihiLogoProps> = ({
  size = 28,
  variant = 'auto',
  showWordmark = false,
  className = ''
}) => {
  const uid = useId().replace(/:/g, '');
  const gradientId = `hachihiLogoBg_${uid}`;
  const [imgFailed, setImgFailed] = useState(false);

  const wordmarkTone =
    variant === 'dark'
      ? 'text-white'
      : variant === 'light'
      ? 'text-slate-900'
      : 'text-slate-900 dark:text-white';

  const frameStrokeOpacity = variant === 'dark' ? '0.55' : '0.42';
  const boxClass = resolveSizeClass(size);

  return (
    <span className={`inline-flex items-center gap-2 shrink-0 ${className}`}>
      {!imgFailed ? (
        <span
          className={`relative inline-flex items-center justify-center overflow-hidden shrink-0 bg-[#0F172A] ring-1 ring-slate-900/15 dark:ring-white/15 shadow-xs ${boxClass}`}
        >
          <img
            src={hachihiLogoImg}
            alt="HACHIHI Network Designer"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover scale-[1.24] select-none pointer-events-none"
          />
        </span>
      ) : (
        <svg
          width={size}
          height={size}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="shrink-0"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#155EEF" />
              <stop offset="100%" stopColor="#0F172A" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill={`url(#${gradientId})`} />
          <rect
            x="6"
            y="6"
            width="52"
            height="52"
            rx="10"
            stroke="#60A5FA"
            strokeOpacity={frameStrokeOpacity}
            strokeWidth="1.25"
          />
          <path
            d="M19 16V48M45 16V48M19 32H45"
            stroke="#FFFFFF"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M24 20V27L29 32L24 37V44M40 20V27L35 32L40 37V44"
            stroke="#38BDF8"
            strokeOpacity="0.85"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="19" cy="16" r="3" fill="#38BDF8" />
          <circle cx="45" cy="16" r="3" fill="#FBBF24" />
          <circle cx="19" cy="48" r="3" fill="#38BDF8" />
          <circle cx="45" cy="48" r="3" fill="#FBBF24" />
          <circle cx="19" cy="32" r="3.2" fill="#38BDF8" />
          <circle cx="45" cy="32" r="3.2" fill="#FBBF24" />
          <circle cx="32" cy="32" r="3.4" fill="#38BDF8" />
        </svg>
      )}
      {showWordmark && (
        <span className={`font-bold tracking-tight text-sm whitespace-nowrap ${wordmarkTone}`}>
          HACHIHI
        </span>
      )}
    </span>
  );
};
