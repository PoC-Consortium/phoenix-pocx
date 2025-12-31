import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { provideRouter } from '@angular/router';
import { BlockchainStateService } from './bitcoin/services/blockchain-state.service';
import { ElectronService } from './core/services/electron.service';
import { NotificationService } from './shared/services';
import { MatDialog } from '@angular/material/dialog';

describe('AppComponent', () => {
  const mockBlockchainState = {
    startPolling: jasmine.createSpy('startPolling'),
  };

  const mockElectronService = {
    isElectron: false,
    onNewVersion: jasmine.createSpy('onNewVersion'),
    onNewVersionCheckNoUpdate: jasmine.createSpy('onNewVersionCheckNoUpdate'),
    onNewVersionDownloadStarted: jasmine.createSpy('onNewVersionDownloadStarted'),
  };

  const mockNotification = {
    info: jasmine.createSpy('info'),
    success: jasmine.createSpy('success'),
  };

  const mockDialog = {
    open: jasmine.createSpy('open'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: BlockchainStateService, useValue: mockBlockchainState },
        { provide: ElectronService, useValue: mockElectronService },
        { provide: NotificationService, useValue: mockNotification },
        { provide: MatDialog, useValue: mockDialog },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should start blockchain polling on init', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(mockBlockchainState.startPolling).toHaveBeenCalled();
  });

  it('should render router-outlet', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });
});
