import { SupportedLanguage } from '../types';

export interface LanguageOption {
  code: SupportedLanguage;
  name: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English (US)' },
  { code: 'es', name: 'Español' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文 (简体)' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
];
