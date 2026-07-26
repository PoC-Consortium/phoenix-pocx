import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';

import { VerifyWordsComponent } from './verify-words.component';
import { DescriptorService } from '../../../bitcoin/services/wallet/descriptor.service';

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

describe('VerifyWordsComponent (verify step gating)', () => {
  let component: VerifyWordsComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<VerifyWordsComponent>>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [VerifyWordsComponent],
      providers: [
        provideAnimations(),
        provideRouter([]),
        {
          provide: DescriptorService,
          useValue: { getWordSuggestions: () => [], getWordlist: () => WORDS },
        },
      ],
    });

    fixture = TestBed.createComponent(VerifyWordsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('words', WORDS);
    fixture.detectChanges();
  });

  it('rolls distinct sorted indices on creation', () => {
    expect(component.verifyIndices.length).toBe(3);
    expect(new Set(component.verifyIndices).size).toBe(3);
    expect([...component.verifyIndices].sort((a, b) => a - b)).toEqual(component.verifyIndices);
  });

  it('passes only once every requested word is correct', () => {
    component.verifyIndices = [0, 2];
    component.verifyWords = ['', ''];

    expect(component.passed()).withContext('nothing typed').toBeFalse();

    component.verifyWords[0] = WORDS[0];
    expect(component.passed()).withContext('one of two correct').toBeFalse();

    component.verifyWords[1] = WORDS[2];
    expect(component.passed()).withContext('both correct').toBeTrue();
  });

  it('tolerates case and surrounding whitespace', () => {
    component.verifyIndices = [1, 4];
    component.verifyWords = [WORDS[1].toUpperCase(), `  ${WORDS[4]}  `];

    expect(component.passed()).toBeTrue();
  });

  it('flags a wrong word per field and does not pass', () => {
    component.verifyIndices = [0];
    component.verifyWords = ['wrongword'];

    expect(component.wordCorrect(0)).toBeFalse();
    expect(component.passed()).toBeFalse();
  });

  it('never passes with an empty phrase/selection', () => {
    component.verifyIndices = [];
    component.verifyWords = [];
    expect(component.passed()).toBeFalse();
  });
});
