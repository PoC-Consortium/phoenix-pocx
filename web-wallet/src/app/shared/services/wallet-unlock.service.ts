import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { I18nService } from '../../core/i18n';
import { WalletManagerService } from '../../bitcoin/services/wallet/wallet-manager.service';
import { WalletRpcService } from '../../bitcoin/services/rpc/wallet-rpc.service';
import { BtcxWalletService } from '../../core/services/btcx-wallet.service';
import { NodeService } from '../../node/services/node.service';
import {
  PassphraseDialogComponent,
  PassphraseDialogResult,
} from '../components/passphrase-dialog/passphrase-dialog.component';

/**
 * WalletUnlockService centralises the "unlock wallet for the session" UX so
 * every surface (toolbar dropdown, wallet-select page, …) shares the same
 * dialog, retry, and error-toast behaviour. The passphrase is forwarded to
 * bitcoin-pocx core and never stored in Phoenix.
 */
@Injectable({ providedIn: 'root' })
export class WalletUnlockService {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly btcxWallet = inject(BtcxWalletService);
  private readonly nodeService = inject(NodeService);
  private readonly i18n = inject(I18nService);

  /**
   * Ensure the wallet can SIGN right now, prompting for the passphrase when
   * needed — the pre-flight every spend path (send, assignments, PSBT sign,
   * RBF, CPFP) runs before firing its RPC:
   *
   * - Remote/BDK: only a passphrase-locked seed blocks (an open wallet is
   *   unlocked by definition); unlocking opens the runtime.
   * - Core: `getwalletinfo.unlocked_until` — undefined means unencrypted,
   *   0 means locked → a short `walletpassphrase` window (default 60 s).
   *
   * Returns false when the user cancels the dialog. A WRONG passphrase
   * throws (surfaces through the caller's normal error display) — same
   * behaviour as the per-page helpers this consolidates.
   */
  async ensureUnlockedForSigning(walletName: string): Promise<boolean> {
    if (this.nodeService.isRemote()) {
      const status = await this.btcxWallet.refreshStatus();
      if (status?.seed !== 'locked') return true;
      const result = await this.promptPassphrase(walletName);
      if (!result) return false;
      await this.btcxWallet.unlock(result.passphrase);
      return true;
    }

    const info = await this.walletRpc.getWalletInfo(walletName);
    if (info.unlocked_until === undefined || info.unlocked_until > 0) {
      return true; // not encrypted, or already unlocked
    }
    const result = await this.promptPassphrase(walletName);
    if (!result) return false;
    await this.walletRpc.walletPassphrase(walletName, result.passphrase, result.timeout);
    return true;
  }

  private async promptPassphrase(walletName: string): Promise<PassphraseDialogResult | null> {
    const dialogRef = this.dialog.open(PassphraseDialogComponent, {
      width: '400px',
      data: { walletName, timeout: 60 },
    });
    return (await dialogRef.afterClosed().toPromise()) ?? null;
  }

  /**
   * Prompt for the passphrase and unlock the wallet for the lifetime of the
   * Phoenix / node session. On a wrong-passphrase failure we surface a toast
   * and re-open the dialog once so a typo doesn't force the user to re-find
   * the icon.
   */
  async promptAndUnlockSession(walletName: string): Promise<boolean> {
    return this.unlockOnce(walletName, false);
  }

  /** Lock an unlocked wallet immediately. */
  async lockNow(walletName: string): Promise<void> {
    try {
      await this.walletManager.lockWallet(walletName);
    } catch (err) {
      console.error('Failed to lock wallet:', err);
    }
  }

  private async unlockOnce(walletName: string, isRetry: boolean): Promise<boolean> {
    const dialogRef = this.dialog.open(PassphraseDialogComponent, {
      width: '400px',
      data: { walletName, mode: 'session' },
    });
    const result: PassphraseDialogResult | null = await dialogRef.afterClosed().toPromise();
    if (!result) return false;
    try {
      await this.walletManager.unlockWalletForSession(walletName, result.passphrase);
      return true;
    } catch (err) {
      console.error('Failed to unlock wallet:', err);
      this.snackBar.open(this.i18n.get('unlock_failed'), this.i18n.get('close'), {
        duration: 4000,
      });
      if (!isRetry) {
        return this.unlockOnce(walletName, true);
      }
      return false;
    }
  }
}
