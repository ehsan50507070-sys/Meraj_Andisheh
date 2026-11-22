import type {
  SmartImportParsedDraft,
  SmartImportSuggestions,
} from '../../core/services/smartImportParser';

export interface SmartImportDraftTransfer {
  draft: SmartImportParsedDraft;
  suggestions: SmartImportSuggestions;
}

let pendingTransfer: SmartImportDraftTransfer | null = null;

export const smartImportDraftBridge = {
  setPendingTransfer(payload: SmartImportDraftTransfer): void {
    pendingTransfer = payload;
  },
  consumePendingTransfer(): SmartImportDraftTransfer | null {
    const current = pendingTransfer;
    pendingTransfer = null;
    return current;
  },
  clear(): void {
    pendingTransfer = null;
  },
};
