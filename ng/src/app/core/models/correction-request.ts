export type CorrectionRequestStatus = 'pending' | 'approved' | 'rejected' | string;

export interface CorrectionRequest {
  id: string;
  userId: string;
  userUsername: string | null;
  txId: string | null;
  txSnapshot: any;
  userMessage: string;
  status: CorrectionRequestStatus;
  adminId: string | null;
  adminUsername: string | null;
  adminNote: string | null;
  patch: any;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}
