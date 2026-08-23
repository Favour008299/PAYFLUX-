import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  X,
  Maximize2,
  Calendar,
  Layers,
  ArrowUpRight,
  Sparkles
} from 'lucide-react';
import { Token } from '../types';
import { formatCurrency } from '../utils/crypto';

interface ChartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  fromToken: Token;
  toToken: Token;
  currency: string;
}

type TimeFrame = '1H' | '24H' | '1W' | '1M' | '1Y';

export const ChartDrawer: React.FC<ChartDrawerProps> = ({
  isOpen,
  onClose,
  fromToken,
  toToken,
  currency,
}) => {
  const [timeframe, setTimeframe] = useState<TimeFrame>('24H');

  // Calculate pair rate
  const pairRate = useMemo(() => {
    if (!toToken.priceUsd || toToken.priceUsd === 0) return 0;
    return fromToken.priceUsd / toToken.priceUsd;
  }, [fromToken.priceUsd, toToken.priceUsd]);

  // Generate synthetic price points for the selected timeframe
  const chartPoints = useMemo(() => {
    const pointsCount = 24;
    const base = pairRate;
    const points: number[] = [];
    const volatility = timeframe === '1H' ? 0.004 : timeframe === '24H' ? 0.02 : 0.08;

    let current = base * (1 - volatility * (pointsCount / 2));
    for (let i = 0; i < pointsCount; i++) {
      const step = (Math.sin(i * 0.8) + (Math.random() - 0.48)) * volatility * base;
      current = Math.max(base * 0.85, current + step);
      points.push(current);
    }
    points[points.length - 1] = base; // Ensure current is last
    return points;
  }, [pairRate, timeframe]);

  const minPoint = Math.min(...chartPoints);
  const maxPoint = Math.max(...chartPoints);
  const isPositive = chartPoints[chartPoints.length - 1] >= chartPoints[0];

  // SVG Path generation
  const svgPath = useMemo(() => {
    const width = 500;
    const height = 180;
    const padding = 15;

    const range = maxPoint - minPoint || 1;
    const points = chartPoints.map((val, idx) => {
      const x = (idx / (chartPoints.length - 1)) * (width - padding * 2) + padding;
      const y = height - padding - ((val - minPoint) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    return `M ${points.join(' L ')}`;
  }, [chartPoints, minPoint, maxPoint]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="chart-modal"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-md border-2 border-slate-900"
                style={{ backgroundColor: fromToken.iconBg, color: fromToken.iconColor }}
              >
                {fromToken.symbol.charAt(0)}
              </div>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-md border-2 border-slate-900"
                style={{ backgroundColor: toToken.iconBg, color: toToken.iconColor }}
              >
                {toToken.symbol.charAt(0)}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base text-white">
                  {fromToken.symbol} / {toToken.symbol}
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  Live Pool
                </span>
              </div>
              <p className="text-[11px] text-slate-400">PayFlux & deBridge Market Feed</p>
            </div>
          </div>

          <button
            id="close-chart-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Rate and 24h change */}
        <div className="mb-4 flex items-baseline justify-between bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80">
          <div>
            <div className="text-[11px] text-slate-400 font-medium">Market Rate</div>
            <div className="text-2xl font-black text-white font-mono flex items-center gap-1.5">
              1 {fromToken.symbol} ={' '}
              {pairRate < 0.0001 ? pairRate.toExponential(4) : pairRate.toFixed(6)}{' '}
              {toToken.symbol}
            </div>
          </div>
          <div
            className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold ${
              isPositive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
            }`}
          >
            {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            <span>{isPositive ? '+3.42%' : '-1.15%'}</span>
          </div>
        </div>

        {/* Timeframe Selectors */}
        <div className="flex items-center justify-between mb-3 bg-slate-950/50 p-1 rounded-xl border border-slate-800">
          {(['1H', '24H', '1W', '1M', '1Y'] as TimeFrame[]).map((tf) => (
            <button
              key={tf}
              id={`tf-${tf}`}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                timeframe === tf
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* SVG Sparkline / Interactive Line */}
        <div className="w-full h-48 bg-slate-950/90 rounded-2xl p-2 border border-slate-800/80 relative overflow-hidden flex items-center justify-center">
          <svg viewBox="0 0 500 180" className="w-full h-full">
            <defs>
              <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#00D4FF" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#00D4FF" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path
              d={`${svgPath} L 485,165 L 15,165 Z`}
              fill="url(#chartGrad)"
            />
            <path
              d={svgPath}
              fill="none"
              stroke="#00D4FF"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          {/* High / Low markers */}
          <div className="absolute top-2 right-3 text-[10px] font-mono text-slate-500">
            High: {maxPoint < 0.001 ? maxPoint.toExponential(3) : maxPoint.toFixed(5)}
          </div>
          <div className="absolute bottom-2 right-3 text-[10px] font-mono text-slate-500">
            Low: {minPoint < 0.001 ? minPoint.toExponential(3) : minPoint.toFixed(5)}
          </div>
        </div>

        {/* Stats footer */}
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <div className="p-2 rounded-xl bg-slate-950/50 border border-slate-800">
            <div className="text-[10px] text-slate-400">24h Volume</div>
            <div className="text-xs font-bold text-white">$1.84M</div>
          </div>
          <div className="p-2 rounded-xl bg-slate-950/50 border border-slate-800">
            <div className="text-[10px] text-slate-400">Total Liquidity</div>
            <div className="text-xs font-bold text-white">$8.95M</div>
          </div>
          <div className="p-2 rounded-xl bg-slate-950/50 border border-slate-800">
            <div className="text-[10px] text-slate-400">Verse LP APR</div>
            <div className="text-xs font-bold text-emerald-400">24.5%</div>
          </div>
        </div>
      </div>
    </div>
  );
};
