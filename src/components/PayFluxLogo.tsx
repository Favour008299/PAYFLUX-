import React from 'react';
import payFluxLogoSrc from '../assets/images/payflux_logo_1787392872726.jpg';

interface PayFluxLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  showTagline?: boolean;
  className?: string;
}

export const PayFluxLogo: React.FC<PayFluxLogoProps> = ({
  size = 'md',
  showText = true,
  showTagline = false,
  className = '',
}) => {
  const sizeMap = {
    xs: { img: 'w-7 h-7', text: 'text-sm', tag: 'text-[9px]' },
    sm: { img: 'w-9 h-9', text: 'text-base', tag: 'text-[10px]' },
    md: { img: 'w-11 h-11', text: 'text-lg', tag: 'text-[11px]' },
    lg: { img: 'w-16 h-16', text: 'text-2xl', tag: 'text-xs' },
    xl: { img: 'w-24 h-24', text: 'text-3xl', tag: 'text-sm' },
  };

  const currentSize = sizeMap[size];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* 3D App Logo Image */}
      <div className="relative shrink-0">
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/30 to-purple-600/30 rounded-2xl blur-md" />
        <img
          src={payFluxLogoSrc}
          alt="PayFlux Logo"
          referrerPolicy="no-referrer"
          className={`${currentSize.img} rounded-2xl object-cover object-center relative border border-cyan-400/30 shadow-lg shadow-cyan-950/60`}
        />
      </div>

      {/* Brand Text */}
      {showText && (
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-1.5 leading-none">
            <span
              className={`font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-cyan-300 bg-clip-text text-transparent ${currentSize.text}`}
            >
              PayFlux
            </span>
            <span className="text-[9px] font-extrabold tracking-wider uppercase px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/25">
              PAY
            </span>
          </div>
          {showTagline ? (
            <p className={`text-slate-400 font-medium tracking-tight mt-1 ${currentSize.tag}`}>
              Pay Your Way. Merchants Get Theirs.
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 font-medium hidden sm:block mt-0.5">
              Crypto Payments & Merchant Hub
            </p>
          )}
        </div>
      )}
    </div>
  );
};
