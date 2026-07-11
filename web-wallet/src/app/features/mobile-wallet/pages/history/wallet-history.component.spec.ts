import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { WalletHistoryComponent } from './wallet-history.component';
import { BtcxWalletService, BtcxWalletTx } from '../../../../core/services/btcx-wallet.service';
import { ClipboardService, ContactsStoreService } from '../../../../shared/services';

function stubTx(i: number): BtcxWalletTx {
  return { txid: `tx${i}` } as BtcxWalletTx;
}

describe('WalletHistoryComponent (fit-derived server-side pagination)', () => {
  let component: WalletHistoryComponent;
  let history: BtcxWalletTx[];
  let transactions: ReturnType<typeof signal<BtcxWalletTx[]>>;
  let transactionsTotal: ReturnType<typeof signal<number>>;
  /** The windows the component requested, newest last. */
  let requests: { limit?: number; offset?: number }[];

  beforeEach(async () => {
    history = Array.from({ length: 40 }, (_, i) => stubTx(i));
    transactions = signal<BtcxWalletTx[]>([]);
    transactionsTotal = signal(0);
    requests = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: BtcxWalletService,
          useValue: {
            transactions,
            transactionsTotal,
            walletActive: signal(true),
            initialize: () => Promise.resolve(),
            // Emulate the Rust-side window: slice + total.
            refreshTransactions: (limit?: number, offset?: number) => {
              requests.push({ limit, offset });
              const start = offset ?? 0;
              const items = history.slice(start, limit === undefined ? undefined : start + limit);
              transactions.set(items);
              transactionsTotal.set(history.length);
              return Promise.resolve(items);
            },
            syncNow: () => Promise.resolve(),
          },
        },
        { provide: ClipboardService, useValue: {} },
        { provide: ContactsStoreService, useValue: { load: () => {} } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new WalletHistoryComponent());
    component.ngOnInit();
    await Promise.resolve(); // initialize()
    await Promise.resolve(); // loadPage's first fetch
  });

  it('adopts the measured fit as the page size and fetches that window', async () => {
    component.onFitRows(7);
    await Promise.resolve();
    expect(component.pageSize()).toBe(7);
    expect(requests[requests.length - 1]).toEqual({ limit: 7, offset: 0 });
    expect(component.visibleTransactions().length).toBe(7);
  });

  it('keeps the page containing the previously first visible tx on fit change', async () => {
    component.onFitRows(8);
    component.onPageChange({ pageIndex: 4, pageSize: 8, length: 40 });
    await Promise.resolve();
    // First visible tx is index 32.
    component.onFitRows(5);
    await Promise.resolve();
    expect(component.pageIndex()).toBe(6); // floor(32 / 5): page 6 spans 30..34
    expect(requests[requests.length - 1]).toEqual({ limit: 5, offset: 30 });
    expect(component.visibleTransactions()[0].txid).toBe('tx30');
  });

  it('clamps to the last page when a refresh shrinks the list below the current page', async () => {
    component.onFitRows(8);
    component.onPageChange({ pageIndex: 4, pageSize: 8, length: 40 });
    await Promise.resolve();
    history = Array.from({ length: 10 }, (_, i) => stubTx(i));
    await component.refresh();
    // Page 4 no longer exists (10 txs / size 8 → last page 1); the reload
    // must land on the last page that still exists.
    expect(component.pageIndex()).toBe(1);
    expect(requests[requests.length - 1]).toEqual({ limit: 8, offset: 8 });
    expect(component.visibleTransactions()[0].txid).toBe('tx8');
  });
});
