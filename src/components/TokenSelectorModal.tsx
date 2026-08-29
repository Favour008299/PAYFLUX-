import React, { useState, useMemo } from 'react';
import {
  Search,
  X,
  Star,
  Check,
  TrendingUp,
  TrendingDown,
  Sparkles,
  ExternalLink,
  Plus
} from 'lucide-react';
import { Token, NetworkType } from '../types';
import { formatCurrency, formatTokenPrice, formatTokenAmount } from '../utils/crypto';
import { TokenIcon } from './TokenIcon';

interface TokenSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  selectedToken: Token;
  onSelectToken: (token: Token) => void;
  currency: string;
  onToggleFavorite?: (symbol: string) => void;
  onImportCustomToken?: (token: Partial<Token>) => void;
}

export const TokenSelectorModal: React.FC<TokenSelectorModalProps> = ({
  isOpen,
  onClose,
  tokens,
  selectedToken,
  onSelectToken,
  currency,
  onToggleFavorite,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'polygon' | 'ethereum' | 'favorite' | 'stablecoin' | 'defi'>('all');

  const filteredTokens = useMemo(() => {
    return tokens.filter((t) => {
      const matchesSearch =
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.network.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.contractAddress && t.contractAddress.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (activeCategory === 'polygon') return t.network === 'polygon';
      if (activeCategory === 'ethereum') return t.network === 'ethereum';
      if (activeCategory === 'favorite') return !!t.isFavorite;
      if (activeCategory === 'stablecoin') return t.category === 'stablecoin';
      if (activeCategory === 'defi') return t.category === 'defi';

      return true;
    });
  }, [tokens, searchQuery, activeCategory]);

  const quickPicks = tokens.slice(0, 5);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="token-selector-modal"
        className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-base text-white">Select a Token</h3>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              Polygon & Ethereum
            </span>
          </div>
          <button
            id="close-token-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3.5 pb-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="token-search-input"
              type="text"
              placeholder="Search by name, symbol, or network..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 focus:border-cyan-500 focus:outline-none text-xs text-white placeholder-slate-500"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Quick Pick Pills */}
        <div className="px-3.5 pb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {quickPicks.map((t) => {
            const tokenKey = t.id || `${t.symbol}-${t.network}`;
            const isSelected = selectedToken.id === t.id || (selectedToken.symbol === t.symbol && selectedToken.network === t.network);
            return (
              <button
                key={tokenKey}
                id={`quick-token-${tokenKey}`}
                onClick={() => {
                  onSelectToken(t);
                  onClose();
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                    : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <TokenIcon token={t} size="xs" />
                <span>{t.symbol}</span>
                <span className="text-[9px] text-slate-400 capitalize">({t.network === 'polygon' ? 'POL' : 'ETH'})</span>
              </button>
            );
          })}
        </div>

        {/* Categories Tabs */}
        <div className="px-3.5 py-1.5 border-b border-slate-800 flex items-center gap-1 text-xs overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
              activeCategory === 'all'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setActiveCategory('polygon')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
              activeCategory === 'polygon'
                ? 'bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Polygon
          </button>
          <button
            onClick={() => setActiveCategory('ethereum')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
              activeCategory === 'ethereum'
                ? 'bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Ethereum
          </button>
          <button
            onClick={() => setActiveCategory('favorite')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
              activeCategory === 'favorite'
                ? 'bg-slate-800 text-amber-300 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
            Favorites
          </button>
          <button
            onClick={() => setActiveCategory('stablecoin')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
              activeCategory === 'stablecoin'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Stablecoins
          </button>
          <button
            onClick={() => setActiveCategory('defi')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
              activeCategory === 'defi'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            DeFi
          </button>
        </div>

        {/* Token List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2">
          {filteredTokens.length === 0 ? (
            <div className="text-center py-10 px-4">
              <p className="text-slate-400 text-xs mb-1">No tokens found</p>
              <p className="text-[11px] text-slate-500">
                Try searching by different name, network or symbol.
              </p>
            </div>
          ) : (
            filteredTokens.map((token) => {
              const tokenKey = token.id || `${token.symbol}-${token.network}`;
              const isSelected = selectedToken.id === token.id || (selectedToken.symbol === token.symbol && selectedToken.network === token.network);
              const balanceUsd = token.balance * token.priceUsd;

              return (
                <div
                  key={tokenKey}
                  id={`token-row-${tokenKey}`}
                  onClick={() => {
                    onSelectToken(token);
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-cyan-500/10 border border-cyan-500/30'
                      : 'hover:bg-slate-800/80 border border-transparent'
                  }`}
                >
                  {/* Left: Icon & Names */}
                  <div className="flex items-center gap-3">
                    <TokenIcon token={token} size="md" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-xs sm:text-sm">
                          {token.symbol}
                        </span>
                        {/* Network Badge */}
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                            token.network === 'polygon'
                              ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                              : token.network === 'ethereum'
                              ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {token.networkName || (token.network === 'polygon' ? 'Polygon' : 'Ethereum')}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        <span>{token.name}</span>
                        <span className="text-slate-600">•</span>
                        <span className="font-mono text-cyan-400/90">{formatTokenPrice(token, currency)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Balance & Price */}
                  <div className="text-right">
                    <div className="font-mono font-bold text-xs text-white">
                      {formatTokenAmount(token.balance)}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      {token.isPriceUnavailable || !token.priceUsd
                        ? '—'
                        : formatCurrency(balanceUsd, currency)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
