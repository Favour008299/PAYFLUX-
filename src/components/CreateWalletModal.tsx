import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldAlert,
  Copy,
  Check,
  Download,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { WalletAccount, NetworkType } from '../types';
import { generateRecoveryPhrase, generateAddress } from '../utils/crypto';

interface CreateWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onWalletCreated: (account: WalletAccount) => void;
  selectedNetwork: NetworkType;
}

export const CreateWalletModal: React.FC<CreateWalletModalProps> = ({
  isOpen,
  onClose,
  onWalletCreated,
  selectedNetwork,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [phrase, setPhrase] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [hasBackedUpChecked, setHasBackedUpChecked] = useState<boolean>(false);

  // Verification challenge state
  const [challengeIndices, setChallengeIndices] = useState<number[]>([2, 6, 10]); // word #3, #7, #11
  const [userSelectedWords, setUserSelectedWords] = useState<Record<number, string>>({});
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // PIN state
  const [pin, setPin] = useState<string>('');
  const [confirmPin, setConfirmPin] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      const newPhrase = generateRecoveryPhrase();
      setPhrase(newPhrase);
      setRevealed(true);
      setCopied(false);
      setHasBackedUpChecked(false);
      setUserSelectedWords({});
      setVerificationError(null);
      setPin('');
      setConfirmPin('');
      setPinError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyPhrase = () => {
    navigator.clipboard.writeText(phrase.join(' '));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadBackup = () => {
    const element = document.createElement('a');
    const file = new Blob([`VERSESWAP SECRET RECOVERY PHRASE\n\nDO NOT SHARE THIS WITH ANYONE!\n\n12-Word Phrase:\n${phrase.join(' ')}\n\nCreated: ${new Date().toISOString()}`], {
      type: 'text/plain',
    });
    element.href = URL.createObjectURL(file);
    element.download = `verseswap-backup-${Date.now()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleVerifyChallenge = () => {
    let isValid = true;
    for (const idx of challengeIndices) {
      if (userSelectedWords[idx] !== phrase[idx]) {
        isValid = false;
        break;
      }
    }

    if (!isValid) {
      setVerificationError('Incorrect word selections. Please double-check your written backup.');
      return;
    }

    setVerificationError(null);
    setStep(4); // Move to PIN setup
  };

  const handleFinishCreation = () => {
    if (pin && pin !== confirmPin) {
      setPinError('PINs do not match.');
      return;
    }

    const newAccount: WalletAccount = {
      address: generateAddress(selectedNetwork),
      name: 'Verse Vault 01',
      type: 'created',
      recoveryPhraseBackedUp: true,
      network: selectedNetwork,
      portfolioBalanceUsd: 1250.0,
      tokens: {
        VERSE: 500000,
        BTC: 0.0,
        BCH: 0.5,
        POL: 100.0,
        USDT: 200.0,
        ETH: 0.05,
        USDC: 50.0,
        DAI: 0.0,
      },
      encryptedPin: pin ? btoa(pin) : undefined,
      createdAt: Date.now(),
    };

    onWalletCreated(newAccount);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        id="create-wallet-modal"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-100 animate-in zoom-in-95 duration-150"
      >
        {/* Step Indicator Top Bar */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-cyan-500 text-slate-950 text-xs font-black flex items-center justify-center">
              {step}
            </span>
            <h3 className="font-extrabold text-base text-white">
              {step === 1 && 'Create New Wallet'}
              {step === 2 && 'Secret Recovery Phrase'}
              {step === 3 && 'Verify Backup'}
              {step === 4 && 'Secure Local PIN'}
            </h3>
          </div>
          <button
            id="close-create-wallet-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* STEP 1: Warning & Education */}
        {step === 1 && (
          <div className="py-4 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-7 h-7" />
            </div>

            <div className="text-center">
              <h4 className="font-black text-lg text-white mb-1">
                Backup Your Secret Recovery Phrase
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                In the next step, you will see 12 secret words. This phrase gives full access to your funds if you ever switch devices or lose your browser session.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs space-y-2 text-slate-300">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>Never share your recovery phrase with anyone, including Verse support.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>PayFlux does not store your keys on any cloud server.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>Store your backup in a safe, offline location.</span>
              </div>
            </div>

            <button
              id="step1-continue-btn"
              onClick={() => setStep(2)}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2"
            >
              <span>I Understand, Show Phrase</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 2: 12-Word Phrase Grid */}
        {step === 2 && (
          <div className="py-4 space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Write down these 12 words in order:</span>
              <button
                onClick={() => setRevealed(!revealed)}
                className="flex items-center gap-1 text-cyan-400 hover:underline text-[11px] font-semibold"
              >
                {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{revealed ? 'Hide' : 'Reveal'}</span>
              </button>
            </div>

            {/* Phrase Grid */}
            <div className="grid grid-cols-3 gap-2 bg-slate-950/90 p-3 rounded-2xl border border-slate-800">
              {phrase.map((word, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 p-2 rounded-xl bg-slate-900 border border-slate-800/80 text-xs"
                >
                  <span className="text-[10px] text-slate-400 font-mono w-4">{idx + 1}.</span>
                  <span className="font-mono font-bold text-white tracking-wide">
                    {revealed ? word : '••••••'}
                  </span>
                </div>
              ))}
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <button
                id="copy-phrase-btn"
                onClick={handleCopyPhrase}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied to Clipboard' : 'Copy Words'}</span>
              </button>

              <button
                id="download-backup-btn"
                onClick={handleDownloadBackup}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span>Download .txt</span>
              </button>
            </div>

            {/* Checkbox confirmation */}
            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 cursor-pointer">
              <input
                id="backup-confirm-checkbox"
                type="checkbox"
                checked={hasBackedUpChecked}
                onChange={(e) => setHasBackedUpChecked(e.target.checked)}
                className="mt-0.5 rounded text-cyan-500 focus:ring-cyan-500 bg-slate-900 border-slate-700"
              />
              <span className="text-[11px] text-slate-300">
                I have written down and securely stored my 12-word secret recovery phrase.
              </span>
            </label>

            <button
              id="step2-continue-btn"
              disabled={!hasBackedUpChecked}
              onClick={() => setStep(3)}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-sm shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2"
            >
              <span>Continue to Verification</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 3: Verification Challenge */}
        {step === 3 && (
          <div className="py-4 space-y-4">
            <p className="text-xs text-slate-300">
              Verify your backup by selecting the correct words for each slot:
            </p>

            <div className="space-y-3">
              {challengeIndices.map((idx) => {
                // Generate 3 random decoy options + the correct word
                const correctWord = phrase[idx];
                return (
                  <div key={idx} className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800">
                    <div className="text-[11px] font-bold text-slate-400 mb-2">
                      Select Word #{idx + 1}:
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[correctWord, phrase[(idx + 3) % 12], phrase[(idx + 7) % 12]]
                        .sort()
                        .map((w) => (
                          <button
                            key={w}
                            onClick={() =>
                              setUserSelectedWords((prev) => ({ ...prev, [idx]: w }))
                            }
                            className={`py-2 rounded-xl text-xs font-mono font-bold border transition-all ${
                              userSelectedWords[idx] === w
                                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            {w}
                          </button>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {verificationError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{verificationError}</span>
              </div>
            )}

            <button
              id="verify-backup-btn"
              onClick={handleVerifyChallenge}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-lg shadow-cyan-500/25 transition-all"
            >
              Verify Phrase
            </button>
          </div>
        )}

        {/* STEP 4: Local PIN Setup & Activation */}
        {step === 4 && (
          <div className="py-4 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h4 className="font-black text-lg text-white mb-1">Set a 4-Digit Local PIN</h4>
              <p className="text-xs text-slate-400">
                Optional: protect wallet transactions on this device with a quick passcode.
              </p>
            </div>

            <div className="space-y-2.5 max-w-xs mx-auto">
              <div>
                <label className="text-[11px] font-bold text-slate-400 mb-1 block">PIN</label>
                <input
                  id="wallet-pin-input"
                  type="password"
                  maxLength={6}
                  placeholder="Enter 4-6 digits (optional)"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full text-center px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm tracking-widest focus:outline-none focus:border-cyan-500"
                />
              </div>

              {pin.length > 0 && (
                <div>
                  <label className="text-[11px] font-bold text-slate-400 mb-1 block">
                    Confirm PIN
                  </label>
                  <input
                    id="wallet-confirm-pin-input"
                    type="password"
                    maxLength={6}
                    placeholder="Re-enter PIN"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                    className="w-full text-center px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm tracking-widest focus:outline-none focus:border-cyan-500"
                  />
                </div>
              )}

              {pinError && <p className="text-rose-400 text-xs text-center">{pinError}</p>}
            </div>

            <button
              id="activate-wallet-btn"
              onClick={handleFinishCreation}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-500 hover:from-emerald-300 hover:to-cyan-400 text-slate-950 font-black text-sm shadow-lg shadow-emerald-500/25 transition-all"
            >
              Activate Wallet & Start Using PayFlux
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
