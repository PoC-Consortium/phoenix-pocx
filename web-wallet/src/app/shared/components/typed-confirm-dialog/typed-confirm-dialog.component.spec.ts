import { TestBed } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import {
  TypedConfirmDialogComponent,
  TypedConfirmDialogData,
} from './typed-confirm-dialog.component';

const DATA: TypedConfirmDialogData = {
  title: 'Delete wallet',
  message: 'Files move to trash.',
  requiredText: 'Savings',
  inputLabel: 'Type the wallet name to confirm',
  confirmText: 'Delete',
};

describe('TypedConfirmDialogComponent', () => {
  let component: TypedConfirmDialogComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<TypedConfirmDialogComponent>>;
  let closedWith: unknown[];

  beforeEach(() => {
    closedWith = [];
    TestBed.configureTestingModule({
      imports: [TypedConfirmDialogComponent],
      providers: [
        provideAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: DATA },
        {
          provide: MatDialogRef,
          useValue: { close: (result?: unknown) => closedWith.push(result) },
        },
      ],
    });
    fixture = TestBed.createComponent(TypedConfirmDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function confirmButton(): HTMLButtonElement {
    const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('button');
    return buttons[buttons.length - 1];
  }

  it('starts with the confirm button disabled', () => {
    expect(component.matches()).toBeFalse();
    expect(confirmButton().disabled).toBeTrue();
  });

  it('stays disabled on a case-mismatched name (the backend compares case-sensitively)', () => {
    component.typed = 'savings';
    component.onTypedChange();
    fixture.detectChanges();

    expect(component.matches()).toBeFalse();
    expect(confirmButton().disabled).toBeTrue();
    // A guarded direct call must not close either.
    component.onConfirm();
    expect(closedWith.length).toBe(0);
  });

  it('arms on the exact name and closes with the typed text', () => {
    component.typed = 'Savings';
    component.onTypedChange();
    fixture.detectChanges();

    expect(component.matches()).toBeTrue();
    expect(confirmButton().disabled).toBeFalse();
    component.onConfirm();
    expect(closedWith).toEqual(['Savings']);
  });

  it('cancel closes with undefined', () => {
    component.onCancel();
    expect(closedWith).toEqual([undefined]);
  });
});
