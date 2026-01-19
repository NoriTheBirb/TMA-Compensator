import type { TransactionType } from './transaction';

export interface AccountAction {
  item: string;
  type: TransactionType;
  tmaSeconds: number;
  label: string;
}
