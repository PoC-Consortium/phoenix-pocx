import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { Store } from '@ngrx/store';

import { CreateWalletFlowComponent } from './create-wallet-flow.component';
import { BtcxWalletService } from '../../core/services/btcx-wallet.service';
import { WalletManagerService } from '../../bitcoin/services/wallet/wallet-manager.service';
import { DescriptorService } from '../../bitcoin/services/wallet/descriptor.service';
import { NodeService } from '../../node/services/node.service';

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

describe('CreateWalletFlowComponent (verify step gating)', () => {
  let component: CreateWalletFlowComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<CreateWalletFlowComponent>>;

  beforeEach(() => {
    const wallet = {
      initialize: () => Promise.resolve(),
      refreshWallets: () => Promise.resolve([]),
      generateMnemonic: () => Promise.resolve(WORDS.join(' ')),
      create: () => Promise.resolve(undefined),
    };

    TestBed.configureTestingModule({
      imports: [CreateWalletFlowComponent],
      providers: [
        provideAnimations(),
        provideRouter([]),
        { provide: BtcxWalletService, useValue: wallet },
        { provide: WalletManagerService, useValue: {} },
        {
          provide: DescriptorService,
          useValue: { getWordSuggestions: () => [], getWordlist: () => WORDS },
        },
        { provide: NodeService, useValue: { isRemote: signal(true) } },
        { provide: Store, useValue: { select: () => of(false) } },
      ],
    });

    fixture = TestBed.createComponent(CreateWalletFlowComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('enables Next only once every verify word is correct', async () => {
    await fixture.whenStable();
    component.words.set(WORDS);
    component.verifyIndices = [0, 2];
    component.verifyWords = ['', '', ''];

    expect(component.verificationPassed()).withContext('nothing typed').toBeFalse();

    component.verifyWords[0] = WORDS[0];
    expect(component.verificationPassed()).withContext('one of two correct').toBeFalse();

    component.verifyWords[1] = WORDS[2];
    expect(component.verificationPassed()).withContext('both correct').toBeTrue();
  });

  it('tolerates case and surrounding whitespace', async () => {
    await fixture.whenStable();
    component.words.set(WORDS);
    component.verifyIndices = [1, 4];
    component.verifyWords = [WORDS[1].toUpperCase(), `  ${WORDS[4]}  `, ''];

    expect(component.verificationPassed()).toBeTrue();
  });

  it('flags a wrong word per field and does not pass', async () => {
    await fixture.whenStable();
    component.words.set(WORDS);
    component.verifyIndices = [0];
    component.verifyWords = ['wrongword', '', ''];

    expect(component.wordCorrect(0)).toBeFalse();
    expect(component.verificationPassed()).toBeFalse();
  });
});
