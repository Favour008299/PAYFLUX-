import React, { useState } from 'react';
import {
  Coins,
  Sparkles,
  TrendingUp,
  Lock,
  ArrowRight,
  ShieldCheck,
  Zap,
  CheckCircle2
} from 'lucide-react';
import { StakingPool, WalletAccount, UserSettings } from '../types';
import { INITIAL_STAKING_POOLS } from '../data/tokens';
import { formatCurrency, formatTokenAmount } from '../utils/crypto';

interface EarnModalProps {
  wallet: WalletAccount | null;
  settings: UserSettings;
  onOpenConnectModal: () => void;
}

export const EarnModal: React.FC<EarnModalProps> = ({
  wallet,
  settings,
  onOpenConnectModal,
}) => {
  const [pools, setPools] = useState<StakingPool[]>(INITIAL_STAKING_POOLS);
  const [stakeAmount, setStakeAmount] = useState<string>('');
  const [activePoolId, setActivePoolId] = useState<string>('verse-staking');
  const [isStaking, setIsStaking] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedPool = pools.find((p) => p.id === activePoolId) || pools[0];
  const userVerseBalance = wallet ? wallet.tokens['VERSE'] || 0 : 0;

  const handleStake = () => {
    if (!wallet) {
      onOpenConnectModal();
      return;
    }
    const amt = parseFloat(stakeAmount);
    if (isNaN(amt) || amt <= 0 || amt > userVerseBalance) return;

    setIsStaking(true);
    setTimeout(() => {
      setPools((prev) =>
        prev.map((p) =>
          p.id === activePoolId ? { ...p, userStaked: p.userStaked + amt } : p
        )
      );
      setIsStaking(false);
      setSuccessMsg(`Successfully staked ${formatTokenAmount(amt)} VERSE!`);
      setStakeAmount('');
      setTimeout(() => setSuccessMsg(null), 4000);
    }, 1200);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 pb-12 text-slate-100">
      {/* Hero Banner */}
      <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-cyan-950/60 via-slate-900 to-blue-950/60 border border-cyan-500/30 relative overflow-hidden shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Verse Yield & Staking Vaults</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              Earn up to <span className="text-cyan-400">34.20% APR</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-lg">
              Put your VERSE tokens to work. Enjoy compounding daily rewards, zero lockup on standard vaults, and automated harvest.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-center sm:text-right">
            <div className="text-xs text-slate-400 font-semibold">Your Total Rewards</div>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              +1,845.20 VERSE
            </div>
            <div className="text-[11px] text-slate-400">
              ≈ {formatCurrency(1845.2 * 0.000342, settings.currency)}
            </div>
          </div>
        </div>
      </div>

      {/* Staking Pools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {pools.map((pool) => {
          const isSelected = pool.id === activePoolId;
          return (
            <div
              key={pool.id}
              onClick={() => setActivePoolId(pool.id)}
              className={`p-5 rounded-3xl border cursor-pointer transition-all ${
                isSelected
                  ? 'bg-slate-900 border-cyan-500 shadow-xl shadow-cyan-950/40 scale-[1.02]'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold">
                  <Coins className="w-5 h-5" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-extrabold text-xs">
                  {pool.apr}% APR
                </span>
              </div>

              <h4 className="font-extrabold text-base text-white mb-1">{pool.name}</h4>
              <div className="text-xs text-slate-400 mb-4">TVL: {pool.totalStaked}</div>

              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-1 mb-4">
                <div className="flex justify-between text-slate-400">
                  <span>Your Staked:</span>
                  <span className="font-mono text-white font-bold">
                    {formatTokenAmount(pool.userStaked)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Lock Period:</span>
                  <span className="text-cyan-300 font-semibold">
                    {pool.lockPeriodDays === 0 ? 'No Lock (Flexible)' : `${pool.lockPeriodDays} Days`}
                  </span>
                </div>
              </div>

              <button
                className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all ${
                  isSelected
                    ? 'bg-cyan-500 text-slate-950 shadow-md'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {isSelected ? 'Selected Vault' : 'Select Vault'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Stake Active Form Card */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl">
        <h3 className="font-extrabold text-base text-white mb-2">
          Stake into {selectedPool.name}
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Deposit VERSE to begin accumulating rewards every block.
        </p>

        {successMsg && (
          <div className="mb-4 p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-400">Amount to Stake</span>
            <span className="text-xs text-slate-400">
              Available: {formatTokenAmount(userVerseBalance)} VERSE
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <input
              type="number"
              placeholder="0.0"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="w-full bg-transparent text-2xl font-black text-white font-mono focus:outline-none"
            />
            <button
              onClick={() => setStakeAmount(userVerseBalance.toString())}
              className="px-3 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 font-bold text-xs hover:bg-cyan-500/30"
            >
              MAX
            </button>
          </div>
        </div>

        <button
          onClick={handleStake}
          disabled={isStaking}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2"
        >
          <Zap className="w-4 h-4 fill-current" />
          <span>{isStaking ? 'Staking Tokens...' : `Stake ${selectedPool.tokenSymbol}`}</span>
        </button>
      </div>
    </div>
  );
};
