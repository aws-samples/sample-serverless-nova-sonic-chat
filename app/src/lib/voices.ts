export type VoiceConfig = {
  id: string;
  label: string;
  language: string;
  gender: 'Female' | 'Male';
  additionalPrompt: string;
};

const promptForLanguage = (lang: string) => {
  return '';
  // seems deprecated in Nova 2 Sonic
  // return `Please respond exclusively in ${lang}. If you have a question or suggestion, ask it in ${lang}. I want to ensure that our communication remains in ${lang}.`;
};

export const voices: VoiceConfig[] = [
  {
    id: 'tiffany',
    label: 'Tiffany',
    language: 'US English',
    gender: 'Female',
    additionalPrompt: 'Please respond exclusively in English.',
  },
  {
    id: 'matthew',
    label: 'Matthew',
    language: 'US English',
    gender: 'Male',
    additionalPrompt: 'Please respond exclusively in English.',
  },
  {
    id: 'amy',
    label: 'Amy',
    language: 'GB English',
    gender: 'Female',
    additionalPrompt: 'Please respond exclusively in English. Use British English as your language for your responses.',
  },
  {
    id: 'ambre',
    label: 'Ambre',
    language: 'French',
    gender: 'Female',
    additionalPrompt: promptForLanguage('French'),
  },
  {
    id: 'florian',
    label: 'Florian',
    language: 'French',
    gender: 'Male',
    additionalPrompt: promptForLanguage('French'),
  },
  {
    id: 'beatrice',
    label: 'Beatrice',
    language: 'Italian',
    gender: 'Female',
    additionalPrompt: promptForLanguage('Italian'),
  },
  {
    id: 'lorenzo',
    label: 'Lorenzo',
    language: 'Italian',
    gender: 'Male',
    additionalPrompt: promptForLanguage('Italian'),
  },
  {
    id: 'greta',
    label: 'Greta',
    language: 'German',
    gender: 'Female',
    additionalPrompt: promptForLanguage('German'),
  },
  {
    id: 'lennart',
    label: 'Lennart',
    language: 'German',
    gender: 'Male',
    additionalPrompt: promptForLanguage('German'),
  },
  {
    id: 'lupe',
    label: 'Lupe',
    language: 'Spanish',
    gender: 'Female',
    additionalPrompt: promptForLanguage('Spanish'),
  },
  {
    id: 'carlos',
    label: 'Carlos',
    language: 'Spanish',
    gender: 'Male',
    additionalPrompt: promptForLanguage('Spanish'),
  },
  {
    id: 'camila',
    label: 'Camila',
    language: 'Portuguese',
    gender: 'Female',
    additionalPrompt: promptForLanguage('Portuguese'),
  },
  {
    id: 'leo',
    label: 'Leo',
    language: 'Portuguese',
    gender: 'Male',
    additionalPrompt: promptForLanguage('Portuguese'),
  },
  {
    id: 'aditi',
    label: 'Aditi',
    language: 'Hindi',
    gender: 'Female',
    additionalPrompt: promptForLanguage('Hindi'),
  },
  {
    id: 'rohan',
    label: 'Rohan',
    language: 'Hindi',
    gender: 'Male',
    additionalPrompt: promptForLanguage('Hindi'),
  },
];

export const voiceConfigurations: Record<string, VoiceConfig> = Object.fromEntries(voices.map((v) => [v.id, v]));
