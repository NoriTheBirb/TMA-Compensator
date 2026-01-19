import type { AccountAction } from '../models/account-action';

export interface AccountGroup {
  name: string;
  actions: AccountAction[];
}

export const DEFAULT_ACCOUNT_CATALOG: ReadonlyArray<AccountGroup> = [
  {
    name: 'Sociedade Simples',
    actions: [
      { item: 'Sociedade Simples', type: 'conferencia', tmaSeconds: 2132, label: '📋 Conferencia' },
      { item: 'Sociedade Simples', type: 'retorno', tmaSeconds: 900, label: '🔄 Retorno' },
    ],
  },
  {
    name: 'Complexa',
    actions: [
      { item: 'Complexa', type: 'conferencia', tmaSeconds: 4860, label: '📋 Conferencia' },
      { item: 'Complexa', type: 'retorno', tmaSeconds: 2700, label: '🔄 Retorno' },
    ],
  },
  {
    name: 'Empresaria Limitada',
    actions: [
      { item: 'Empresaria Limitada', type: 'conferencia', tmaSeconds: 3032, label: '📋 Conferencia' },
      { item: 'Empresaria Limitada', type: 'retorno', tmaSeconds: 1440, label: '🔄 Retorno' },
    ],
  },
  {
    name: 'Micro Empresario Individual',
    actions: [
      { item: 'Micro Empresario Individual', type: 'conferencia', tmaSeconds: 1980, label: '📋 Conferencia' },
      { item: 'Micro Empresario Individual', type: 'retorno', tmaSeconds: 900, label: '🔄 Retorno' },
    ],
  },
] as const;
