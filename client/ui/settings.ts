import type { QualitySetting } from '../game/quality';

export const qualityOptions = (): { value: QualitySetting; label: string }[] => [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Média' },
  { value: 'low', label: 'Baixa' },
];
