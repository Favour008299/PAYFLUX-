import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { SupportedLanguage } from '../types';
import { LANGUAGES, LanguageOption } from './types';
import { en, Translations } from './translations/en';
import { es } from './translations/es';
import { ja } from './translations/ja';
import { zh } from './translations/zh';
import { fr } from './translations/fr';
import { pt } from './translations/pt';

const TRANSLATIONS: Record<SupportedLanguage, Translations> = {
  en,
  es,
  ja,
  zh,
  fr,
  pt,
};

interface LanguageContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: keyof Translations | string, params?: Record<string, string | number>) => string;
  languages: LanguageOption[];
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = 'payflux_language';
const LEGACY_STORAGE_KEY = 'verseswap_language';

export function getInitialLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved && (saved === 'en' || saved === 'es' || saved === 'ja' || saved === 'zh' || saved === 'fr' || saved === 'pt')) {
      return saved as SupportedLanguage;
    }
    // Check if saved in verseswap_settings
    const settingsStr = localStorage.getItem('verseswap_settings');
    if (settingsStr) {
      const parsed = JSON.parse(settingsStr);
      if (parsed?.language && (parsed.language === 'en' || parsed.language === 'es' || parsed.language === 'ja' || parsed.language === 'zh' || parsed.language === 'fr' || parsed.language === 'pt')) {
        return parsed.language as SupportedLanguage;
      }
    }
  } catch (_) {}
  return 'en';
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<SupportedLanguage>(getInitialLanguage);

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, lang);
        // Also update verseswap_settings if exists
        const settingsStr = localStorage.getItem('verseswap_settings');
        if (settingsStr) {
          const parsed = JSON.parse(settingsStr);
          parsed.language = lang;
          localStorage.setItem('verseswap_settings', JSON.stringify(parsed));
        }
        document.documentElement.lang = lang;
      } catch (err) {
        console.warn('Failed to persist language setting:', err);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const t = useCallback(
    (key: keyof Translations | string, params?: Record<string, string | number>): string => {
      const currentDict = TRANSLATIONS[language] || TRANSLATIONS.en;
      let text: string = (currentDict as any)[key] || (TRANSLATIONS.en as any)[key] || key;

      if (params) {
        Object.entries(params).forEach(([paramKey, paramVal]) => {
          text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
        });
      }

      return text;
    },
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      languages: LANGUAGES,
    }),
    [language, setLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      language: 'en' as SupportedLanguage,
      setLanguage: () => {},
      t: (key: string) => (en as any)[key] || key,
      languages: LANGUAGES,
    };
  }
  return context;
}

export const useLanguage = useTranslation;
