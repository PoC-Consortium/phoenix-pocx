import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { provideRouter } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { BlockchainStateService } from './bitcoin/services/blockchain-state.service';
import { ElectronService } from './core/services/electron.service';
import { CookieAuthService } from './core/auth/cookie-auth.service';
import { NotificationService } from './shared/services';
import { MiningService } from './mining/services';
import { NodeService } from './node';
import { I18nService } from './core/i18n';
import { MatDialog } from '@angular/material/dialog';

describe('AppComponent', () => {
  const mockBlockchainState = {
    startPolling: jasmine.createSpy('startPolling'),
  };

  const mockElectronService = {
    isDesktop: false,
    isElectron: false,
    onNewVersion: jasmine.createSpy('onNewVersion'),
    onNewVersionCheckNoUpdate: jasmine.createSpy('onNewVersionCheckNoUpdate'),
    onNewVersionDownloadStarted: jasmine.createSpy('onNewVersionDownloadStarted'),
  };

  const mockCookieAuth = {
    refreshCredentials: jasmine.createSpy('refreshCredentials'),
  };

  const mockNotification = {
    info: jasmine.createSpy('info'),
    success: jasmine.createSpy('success'),
  };

  const mockMiningService = {
    minerRunning: jasmine.createSpy('minerRunning').and.returnValue(false),
    plotterUIState: jasmine.createSpy('plotterUIState').and.returnValue('complete'),
  };

  const mockNodeService = {
    isManaged: jasmine.createSpy('isManaged').and.returnValue(false),
    isInstalled: jasmine.createSpy('isInstalled').and.returnValue(false),
    isRunning: jasmine.createSpy('isRunning').and.returnValue(false),
    detectExistingNode: jasmine.createSpy('detectExistingNode'),
    refreshNodeStatus: jasmine.createSpy('refreshNodeStatus'),
  };

  const mockI18n = {
    get: jasmine.createSpy('get').and.callFake((key: string) => key),
  };

  const mockDialog = {
    open: jasmine.createSpy('open'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        provideMockStore(),
        { provide: BlockchainStateService, useValue: mockBlockchainState },
        { provide: ElectronService, useValue: mockElectronService },
        { provide: CookieAuthService, useValue: mockCookieAuth },
        { provide: NotificationService, useValue: mockNotification },
        { provide: MiningService, useValue: mockMiningService },
        { provide: NodeService, useValue: mockNodeService },
        { provide: I18nService, useValue: mockI18n },
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
