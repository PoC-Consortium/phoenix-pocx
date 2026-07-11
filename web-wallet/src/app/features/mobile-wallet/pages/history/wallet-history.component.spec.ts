import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { WalletHistoryComponent } from './wallet-history.component';
import { BtcxWalletService, BtcxWalletTx } from '../../../../core/services/btcx-wallet.service';
import { ClipboardService, ContactsStoreService } from '../../../../shared/services';

function stubTx(i: number): BtcxWalletTx {
  return { txid: `tx${i}` } as BtcxWalletTx;
}

describe('WalletHistoryComponent (fit-derived pagination)', () => {
  let component: WalletHistoryComponent;
  let transactions: ReturnType<typeof signal<BtcxWalletTx[]>>;

  beforeEach(() => {
    transactions = signal(Array.from({ length: 40 }, (_, i) => stubTx(i)));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: BtcxWalletService,
          useValue: {
            transactions,
            walletActive: signal(true),
            initialize: () => Promise.resolve(),
            refreshTransactions: () => Promise.resolve(),
            syncNow: () => Promise.resolve(),
          },
        },
        { provide: ClipboardService, useValue: {} },
        { provide: ContactsStoreService, useValue: { load: () => {} } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new WalletHistoryComponent());
  });

  it('adopts the measured fit as the page size', () => {
    component.onFitRows(7);
    expect(component.pageSize()).toBe(7);
    expect(component.visibleTransactions().length).toBe(7);
  });

  it('keeps the page containing the previously first visible tx on fit change', () => {
    component.onFitRows(8);
    component.onPageChange({ pageIndex: 4, pageSize: 8, length: 40 });
    // First visible tx is index 32.
    component.onFitRows(5);
    expect(component.pageIndex()).toBe(6); // floor(32 / 5): page 6 spans 30..34
    expect(component.visibleTransactions()[0].txid).toBe('tx30');
  });

  it('clamps the page when a refresh shrinks the list below the current page', () => {
    component.onFitRows(8);
    component.onPageChange({ pageIndex: 4, pageSize: 8, length: 40 });
    transactions.set(Array.from({ length: 10 }, (_, i) => stubTx(i)));
    expect(component.visibleTransactions()[0].txid).toBe('tx8'); // last page (1)
  });
});
