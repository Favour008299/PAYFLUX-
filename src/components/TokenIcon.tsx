import React, { useState, useId } from 'react';
import { Token } from '../types';

interface TokenIconProps {
  token: Token | { symbol: string; name?: string; iconBg?: string; iconColor?: string; logoUrl?: string };
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

const SIZE_CLASSES = {
  xs: 'w-4 h-4 text-[9px]',
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs font-bold',
  lg: 'w-10 h-10 text-sm font-bold',
  xl: 'w-12 h-12 text-base font-black',
  '2xl': 'w-16 h-16 text-xl font-black',
};

/**
 * Exact official VERSE token logo as provided in reference image:
 * - Circular background with electric cyan -> royal blue -> deep purple -> radiant magenta/pink gradient
 * - Overlapping white folded "V" ribbon symbol:
 *   - Pure solid white (#FFFFFF) left arm overlapping in front
 *   - Translucent luminous lavender-white ribbon folding behind on the right
 */
export const OfficialVerseLogo: React.FC<{ sizeClass?: string; className?: string }> = ({
  sizeClass = 'w-8 h-8',
  className = '',
}) => {
  const rawId = useId();
  const idPrefix = rawId.replace(/[^a-zA-Z0-9]/g, '');

  return (
    <div
      className={`relative rounded-full flex-shrink-0 flex items-center justify-center select-none overflow-hidden ${sizeClass} ${className}`}
      title="Verse (VERSE)"
    >
      <svg
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <defs>
          {/* Exact Official Cyan -> Royal Blue -> Deep Purple -> Radiant Magenta/Pink Gradient */}
          <linearGradient
            id={`verseBgGrad_${idPrefix}`}
            x1="20"
            y1="20"
            x2="185"
            y2="185"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#00B4FF" />
            <stop offset="30%" stopColor="#0066FF" />
            <stop offset="68%" stopColor="#8E00FF" />
            <stop offset="100%" stopColor="#EB00FF" />
          </linearGradient>

          {/* Translucent Luminous Fold Gradient for Right Arm */}
          <linearGradient
            id={`verseFoldGrad_${idPrefix}`}
            x1="100"
            y1="135"
            x2="145"
            y2="75"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.86" />
            <stop offset="100%" stopColor="#F2E6FF" stopOpacity="0.72" />
          </linearGradient>
        </defs>

        {/* Circular Gradient Background */}
        <circle cx="100" cy="100" r="100" fill={`url(#verseBgGrad_${idPrefix})`} />

        {/* Right Arm: Translucent Lavender Ribbon folding behind */}
        <g transform="translate(100, 140) rotate(27) translate(-100, -140)">
          <rect x="82" y="65" width="36" height="80" rx="18" fill={`url(#verseFoldGrad_${idPrefix})`} />
        </g>

        {/* Left Arm: Solid Pure White (#FFFFFF) overlapping in front */}
        <g transform="translate(100, 140) rotate(-27) translate(-100, -140)">
          <rect x="82" y="65" width="36" height="80" rx="18" fill="#FFFFFF" />
        </g>
      </svg>
    </div>
  );
};

// Reliable live token-data sources for other crypto token logos
const LIVE_TOKEN_LOGOS: Record<string, { primary: string; fallback: string }> = {
  BTC: {
    primary: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png',
    fallback: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  },
  ETH: {
    primary: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
    fallback: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
  },
  BCH: {
    primary: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoincash/info/logo.png',
    fallback: 'https://assets.coingecko.com/coins/images/780/large/bitcoin-cash-circle.png',
  },
  POL: {
    primary: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png',
    fallback: 'https://tokens-data.1inch.io/images/0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0.png',
  },
  USDT: {
    primary: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
    fallback: 'https://tokens-data.1inch.io/images/0xdac17f958d2ee523a2206206994597c13d831ec7.png',
  },
  USDC: {
    primary: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
    fallback: 'https://tokens-data.1inch.io/images/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png',
  },
  DAI: {
    primary: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
    fallback: 'https://tokens-data.1inch.io/images/0x6b175474e89094c44da98b954eedeac495271d0f.png',
  },
  WBTC: {
    primary: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
    fallback: 'https://tokens-data.1inch.io/images/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.png',
  },
};

export const TokenIcon: React.FC<TokenIconProps> = ({
  token,
  size = 'md',
  className = '',
}) => {
  const [useFallback, setUseFallback] = useState(false);
  const [imageError, setImageError] = useState(false);

  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const sym = token.symbol?.toUpperCase();

  // For VERSE, always use the exact official logo matching the reference image
  if (sym === 'VERSE') {
    return <OfficialVerseLogo sizeClass={sizeClass} className={className} />;
  }

  const knownLogo = LIVE_TOKEN_LOGOS[sym];
  const primaryLogo = token.logoUrl || knownLogo?.primary;
  const fallbackLogo = knownLogo?.fallback;
  const currentLogoSrc = useFallback ? fallbackLogo : primaryLogo;

  const handleImageError = () => {
    if (!useFallback && fallbackLogo && fallbackLogo !== primaryLogo) {
      setUseFallback(true);
    } else {
      setImageError(true);
    }
  };

  if (currentLogoSrc && !imageError) {
    return (
      <div className={`relative rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center bg-slate-900 border border-slate-700/50 shadow-sm ${sizeClass} ${className}`}>
        <img
          src={currentLogoSrc}
          alt={`${token.symbol} token logo`}
          referrerPolicy="no-referrer"
          onError={handleImageError}
          className="w-full h-full object-cover rounded-full select-none"
        />
      </div>
    );
  }

  const bg = token.iconBg || '#00D4FF';
  const color = token.iconColor || '#000000';

  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 shadow-sm font-bold select-none ${sizeClass} ${className}`}
      style={{ backgroundColor: bg, color: color }}
    >
      {token.symbol ? token.symbol.charAt(0) : '?'}
    </div>
  );
};
