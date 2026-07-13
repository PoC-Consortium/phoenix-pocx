// Shared Components - Barrel Export

// Layout
export { PageLayoutComponent } from './page-layout/page-layout.component';
export type { BreadcrumbItem } from './page-layout/page-layout.component';

// Dialogs
export { PassphraseDialogComponent } from './passphrase-dialog/passphrase-dialog.component';
export type {
  PassphraseDialogData,
  PassphraseDialogResult,
} from './passphrase-dialog/passphrase-dialog.component';

export { ConfirmDialogComponent } from './confirm-dialog/confirm-dialog.component';
export type { ConfirmDialogData } from './confirm-dialog/confirm-dialog.component';

export { TypedConfirmDialogComponent } from './typed-confirm-dialog/typed-confirm-dialog.component';
export type { TypedConfirmDialogData } from './typed-confirm-dialog/typed-confirm-dialog.component';

export { NameDialogComponent } from './name-dialog/name-dialog.component';
export type { NameDialogData } from './name-dialog/name-dialog.component';

export { UpdateDialogComponent } from './update-dialog/update-dialog.component';

// Display Components
export { AddressDisplayComponent } from './address-display/address-display.component';
export {
  AddressCoinsListComponent,
  aggregateCoins,
} from './address-coins-list/address-coins-list.component';
export type { AddressBalance } from './address-coins-list/address-coins-list.component';
export { BalanceDisplayComponent } from './balance-display/balance-display.component';
export { ElectrumServerListComponent } from './electrum-server-list/electrum-server-list.component';
export { EmptyStateComponent } from './empty-state/empty-state.component';
export { HashRefComponent } from './hash-ref/hash-ref.component';
export type { HashRefKind } from './hash-ref/hash-ref.component';
export { LoadingSpinnerComponent } from './loading-spinner/loading-spinner.component';
export { StepHeaderComponent } from './step-header/step-header.component';

// Seed phrase (shared by create-wallet / import-wallet / multisig wizards)
export { MnemonicDisplayComponent } from './mnemonic-display/mnemonic-display.component';
export { MnemonicEntryComponent } from './mnemonic-entry/mnemonic-entry.component';
export type { MnemonicEntryState } from './mnemonic-entry/mnemonic-entry.component';
