import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideMockStore } from '@ngrx/store/testing';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

import { WatchOnlyComponent } from './watch-only.component';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { POCX_NETWORKS } from '../../../../bitcoin/utils/address-validation';
import { selectNetwork } from '../../../../store/settings/settings.selectors';

function mainnetAddress(): string {
  const payload = new Uint8Array(21);
  payload[0] = POCX_NETWORKS.mainnet.p2pkh;
  return base58check(sha256).encode(payload);
}

describe('WatchOnlyComponent', () => {
  let component: WatchOnlyComponent;
  let walletManager: jasmine.SpyObj<WalletManagerService>;

  beforeEach(() => {
    walletManager = jasmine.createSpyObj('WalletManagerService', ['createWatchOnlyWallet']);

    TestBed.configureTestingModule({
      imports: [WatchOnlyComponent],
      providers: [
        provideAnimations(),
        provideRouter([]),
        provideMockStore({
          selectors: [{ selector: selectNetwork, value: 'mainnet' }],
        }),
        { provide: WalletManagerService, useValue: walletManager },
        { provide: MatSnackBar, useValue: { open: () => ({ onAction: () => ({ subscribe: () => undefined }) }) } },
      ],
    });

    component = TestBed.createComponent(WatchOnlyComponent).componentInstance;
  });

  it('rejects bare xpubs with the matching error key', () => {
    component.entryInput =
      'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';
    component.addEntry();
    expect(component.pendingEntries().length).toBe(0);
    expect(component.entryError()?.key).toBe('watch_only_entry_error_bare_xpub');
  });

  it('adds a valid address and clears the input', () => {
    component.entryInput = mainnetAddress();
    component.addEntry();
    expect(component.pendingEntries().length).toBe(1);
    expect(component.pendingEntries()[0].kind).toBe('address');
    expect(component.entryInput).toBe('');
    expect(component.entryError()).toBeNull();
  });

  it('refuses duplicates within the pending list', () => {
    const addr = mainnetAddress();
    component.entryInput = addr;
    component.addEntry();
    component.entryInput = addr;
    component.addEntry();
    expect(component.pendingEntries().length).toBe(1);
    expect(component.entryError()?.key).toBe('watch_only_entry_error_duplicate');
  });

  it('removes an entry by id', () => {
    component.entryInput = mainnetAddress();
    component.addEntry();
    const [entry] = component.pendingEntries();
    component.removeEntry(entry.id);
    expect(component.pendingEntries().length).toBe(0);
  });

  it('cannot commit when the pending list is empty', () => {
    expect(component.canCommit()).toBeFalse();
  });

  it('cannot commit when rescan=date without a chosen date', () => {
    component.entryInput = mainnetAddress();
    component.addEntry();
    component.setRescanKind('date');
    expect(component.canCommit()).toBeFalse();
  });

  it('forwards descriptors to wallet manager on commit', async () => {
    walletManager.createWatchOnlyWallet.and.resolveTo();
    component.walletName = 'Test';
    component.entryInput = mainnetAddress();
    component.addEntry();
    component.setRescanKind('genesis');
    await component.commit();

    expect(walletManager.createWatchOnlyWallet).toHaveBeenCalledTimes(1);
    const args = walletManager.createWatchOnlyWallet.calls.mostRecent().args[0];
    expect(args.walletName).toBe('Test');
    expect(args.descriptors.length).toBe(1);
    expect(args.descriptors[0]).toContain('addr(');
    expect(args.rescan).toEqual({ kind: 'genesis' });
  });
});
