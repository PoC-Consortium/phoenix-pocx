import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';

import { WalletSendComponent } from './wallet-send.component';
import {
  BtcxWalletService,
  BtcxBalance,
  BtcxSendRequest,
} from '../../../../core/services/btcx-wallet.service';
import { ClipboardService } from '../../../../shared/services';

const BALANCE: BtcxBalance = {
  confirmedSat: 5_000_000_000,
  trustedPendingSat: 0,
  untrustedPendingSat: 0,
  immatureSat: 0,
  spendableSat: 5_000_000_000,
  totalSat: 5_000_000_000,
};

describe('WalletSendComponent (MAX / send-all)', () => {
  let component: WalletSendComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<WalletSendComponent>>;
  let sendCalls: BtcxSendRequest[];

  beforeEach(() => {
    sendCalls = [];
    const wallet = {
      balance: signal<BtcxBalance | null>(BALANCE),
      network: signal('mainnet'),
      walletActive: signal(true),
      initialize: () => Promise.resolve(),
      refreshBalance: () => Promise.resolve(BALANCE),
      fetchFeeEstimates: () => Promise.resolve({ minSatPerVb: 1, fast: 3, normal: 2, slow: 1 }),
      send: (request: BtcxSendRequest) => {
        sendCalls.push(request);
        return Promise.resolve('a'.repeat(64));
      },
    };

    TestBed.configureTestingModule({
      imports: [WalletSendComponent],
      providers: [
        provideAnimations(),
        provideRouter([]),
        { provide: BtcxWalletService, useValue: wallet },
        { provide: ClipboardService, useValue: { copyTxid: () => Promise.resolve(true) } },
      ],
    });

    fixture = TestBed.createComponent(WalletSendComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('MAX click sets send-all and fills the amount field with the spendable balance', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    const maxButton: HTMLButtonElement = fixture.nativeElement.querySelector('.max-button');
    expect(maxButton).withContext('MAX button renders').toBeTruthy();
    maxButton.click();
    fixture.detectChanges();

    expect(component.sendAll).toBeTrue();
    // The field must show what will be swept — not sit empty.
    expect(component.amount).toBe(50);
    expect(maxButton.classList).toContain('selected');
  });

  it('MAX click again clears send-all and empties the amount', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    const maxButton: HTMLButtonElement = fixture.nativeElement.querySelector('.max-button');
    maxButton.click();
    fixture.detectChanges();
    maxButton.click();
    fixture.detectChanges();

    expect(component.sendAll).toBeFalse();
    expect(component.amount).toBeNull();
  });

  it('send-all review is possible without a typed amount and sends sendAll (no amountSat)', async () => {
    await fixture.whenStable();
    component.address = 'addr';
    component.addressValid.set(true);
    component.toggleSendAll();
    fixture.detectChanges();

    expect(component.canReview()).toBeTrue();
    component.review();
    await component.send();

    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].sendAll).toBeTrue();
    expect(sendCalls[0].amountSat).toBeUndefined();
    expect(sendCalls[0].feeTarget).toBe(6);
  });

  it('a typed amount survives a MAX round-trip being discarded (send uses amountSat)', async () => {
    await fixture.whenStable();
    component.address = 'addr';
    component.addressValid.set(true);
    component.amount = 1.5;
    fixture.detectChanges();

    expect(component.canReview()).toBeTrue();
    component.review();
    await component.send();

    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].sendAll).toBeUndefined();
    expect(sendCalls[0].amountSat).toBe(150_000_000);
  });
});
