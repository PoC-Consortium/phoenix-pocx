import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { I18nService } from '../../core/i18n';
import { WalletManagerService } from '../../bitcoin/services/wallet/wallet-manager.service';
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
  private readonly i18n = inject(I18nService);

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
