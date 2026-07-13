import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';

import { WalletCreateComponent } from './wallet-create.component';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';

const WORDS = [
  'abandon',
  'ability',
  'able',
  'about',
  'above',
  'absent',
  'absorb',
  'abstract',
  'absurd',
  'abuse',
  'access',
  'accident',
];

describe('WalletCreateComponent (verify step Next enable — 2.1.1 regression)', () => {
  let component: WalletCreateComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<WalletCreateComponent>>;

  beforeEach(() => {
    const wallet = {
      balance: signal(null),
      network: signal('mainnet'),
      walletActive: signal(false),
      initialize: () => Promise.resolve(),
      refreshWallets: () => Promise.resolve([]),
      generateMnemonic: () => Promise.resolve(WORDS.join(' ')),
      create: () => Promise.resolve(undefined),
    };

    TestBed.configureTestingModule({
      imports: [WalletCreateComponent],
      providers: [
        provideAnimations(),
        provideRouter([]),
        { provide: BtcxWalletService, useValue: wallet },
      ],
    });

    fixture = TestBed.createComponent(WalletCreateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('enables Next once every verify word is typed (signal recomputes)', async () => {
    await fixture.whenStable();
    component.words.set(WORDS);

    // Two positions to confirm, mirroring startVerify()'s output shape.
    component.checks.set([
      { index: 0, entered: '' },
      { index: 2, entered: '' },
    ]);
    fixture.detectChanges();

    // Nothing typed yet — the button must be disabled.
    expect(component.allChecksFilled()).toBeFalse();

    // Simulate the user typing into each field via the change handler that
    // the template's (ngModelChange) invokes. With the old plain
    // [(ngModel)]="check.entered" mutation the signal reference never
    // changed, so allChecksFilled() stayed false forever (the 2.1.0 bug).
    component.setCheckEntered(0, WORDS[0]);
    expect(component.allChecksFilled())
      .withContext('one of two filled — still disabled')
      .toBeFalse();

    component.setCheckEntered(2, WORDS[2]);
    expect(component.allChecksFilled()).withContext('both filled — Next enables').toBeTrue();
  });

  it('verify() reads the words entered through setCheckEntered and advances', async () => {
    await fixture.whenStable();
    component.words.set(WORDS);
    component.checks.set([
      { index: 1, entered: '' },
      { index: 4, entered: '' },
    ]);

    component.setCheckEntered(1, WORDS[1].toUpperCase()); // case/trim tolerated
    component.setCheckEntered(4, `  ${WORDS[4]}  `);
    component.verify();

    expect(component.verifyError()).toBeFalse();
    expect(component.step()).toBe('protect');
  });

  it('verify() flags a mismatch and does not advance', async () => {
    await fixture.whenStable();
    component.words.set(WORDS);
    component.step.set('verify');
    component.checks.set([{ index: 0, entered: '' }]);

    component.setCheckEntered(0, 'wrongword');
    component.verify();

    expect(component.verifyError()).toBeTrue();
    expect(component.step()).toBe('verify');
  });
});
