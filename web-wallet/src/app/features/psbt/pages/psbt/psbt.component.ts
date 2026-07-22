import {
  Component,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  ViewChild,
  DestroyRef,
} from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import {
  AddressDisplayComponent,
  ConfirmDialogComponent,
  PassphraseDialogComponent,
} from '../../../../shared';
import type { PassphraseDialogResult } from '../../../../shared';
import { NotificationService } from '../../../../shared/services';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { WalletService } from '../../../../bitcoin/services/wallet/wallet.service';
import { WalletRpcService } from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { BlockchainRpcService } from '../../../../bitcoin/services/rpc/blockchain-rpc.service';
import { BtcxWalletService } from '../../../../core/services/btcx-wallet.service';
import { AppModeService } from '../../../../core/services/app-mode.service';
import { NodeService } from '../../../../node/services/node.service';
import { ElectronService } from '../../../../core/services/electron.service';
import { selectNetwork } from '../../../../store/settings/settings.selectors';
import { PsbtService } from '../../services/psbt.service';
import type { PsbtDocument, PsbtDraft, PsbtOutputView } from '../../psbt.models';
import { PsbtComposeComponent } from '../../components/psbt-compose/psbt-compose.component';
import { PsbtImportDialogComponent } from '../../components/psbt-import-dialog/psbt-import-dialog.component';

type PsbtView = 'start' | 'compose' | 'doc' | 'success';

/**
 * PSBT workbench page (Transactions → PSBT).
 *
 * Treats a PSBT as a document with a lifecycle (compose/import → sign →
 * combine → finalize → broadcast) that can be entered at any point:
 * hand-roll a new transaction, or continue one started elsewhere — a
 * co-signer's file, an air-gapped machine, or (future) a hardware device.
 * Drafts persist locally so multisig coordination can span sessions.
 */
@Component({
  selector: 'app-psbt',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    DecimalPipe,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDialogModule,
    I18nPipe,
    AddressDisplayComponent,
    PsbtComposeComponent,
  ],
  template: `
    <div class="page-layout">
      <!-- Header -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'psbt_title' | i18n }}</h1>
        </div>
      </div>

      <div class="content" [class.wide]="wideLayout()">
        <!-- Lifecycle steps (mirrors mining/wallet setup wizards) -->
        <div class="step-indicator">
          @for (step of steps; track step; let i = $index) {
            @if (i > 0) {
              <div class="step-line" [class.complete]="currentStep() >= i"></div>
            }
            <div class="step">
              <div
                class="step-circle"
                [class.active]="viewedStep() === i"
                [class.complete]="currentStep() > i && viewedStep() !== i"
                [class.inactive]="currentStep() < i"
              >
                @if (currentStep() > i && viewedStep() !== i) {
                  &#10003;
                } @else {
                  {{ i + 1 }}
                }
              </div>
              <span class="step-label" [class.active]="viewedStep() === i"
                >{{ step | i18n }}{{ i === 1 ? signProgress() : '' }}</span
              >
            </div>
          }
        </div>

        <!-- ================= START ================= -->
        @if (view() === 'start') {
          <div class="start-column">
            <div class="card options-card">
              <div
                class="mode-option"
                (click)="startCompose()"
                (keydown.enter)="startCompose()"
                tabindex="0"
                role="button"
              >
                <mat-icon class="mode-icon">edit_note</mat-icon>
                <div class="mode-details">
                  <div class="mode-title">{{ 'psbt_door_compose' | i18n }}</div>
                  <div class="mode-desc">{{ 'psbt_door_compose_hint' | i18n }}</div>
                </div>
              </div>
              <div
                class="mode-option"
                (click)="importPsbt()"
                (keydown.enter)="importPsbt()"
                tabindex="0"
                role="button"
              >
                <mat-icon class="mode-icon">file_open</mat-icon>
                <div class="mode-details">
                  <div class="mode-title">{{ 'psbt_door_import' | i18n }}</div>
                  <div class="mode-desc">{{ 'psbt_door_import_hint' | i18n }}</div>
                </div>
              </div>
            </div>

            <div class="card drafts-card">
              <div class="card-head">
                <h3 class="section-title">{{ 'psbt_in_progress' | i18n }}</h3>
                <span class="section-aside">{{ 'psbt_saved_locally' | i18n }}</span>
              </div>
              @if (drafts().length === 0) {
                <div class="drafts-empty">
                  <mat-icon>hourglass_empty</mat-icon>
                  <p>{{ 'psbt_no_drafts' | i18n }}</p>
                </div>
              } @else {
                @for (draft of drafts(); track draft.id) {
                  <div
                    class="draft-row"
                    (click)="openDraft(draft)"
                    (keydown.enter)="openDraft(draft)"
                    tabindex="0"
                    role="button"
                  >
                    <span class="badge" [class]="draft.status">
                      <mat-icon>{{ statusIcon(draft.status) }}</mat-icon>
                      {{ 'psbt_status_' + draft.status | i18n }}
                    </span>
                    <div class="draft-body">
                      <div class="draft-name">{{ draft.name }}</div>
                      <div class="draft-meta">
                        {{ draft.amountLabel }}
                        @if (draft.walletName) {
                          · {{ draft.walletName }}
                        }
                        · {{ draft.updatedAt | date: 'short' }}
                      </div>
                    </div>
                    <button
                      mat-icon-button
                      class="draft-delete"
                      (click)="$event.stopPropagation(); deleteDraft(draft)"
                      [matTooltip]="'psbt_delete_draft' | i18n"
                    >
                      <mat-icon>delete_outline</mat-icon>
                    </button>
                    <mat-icon class="draft-chevron">chevron_right</mat-icon>
                  </div>
                }
              }
            </div>
          </div>
        }

        <!-- ================= COMPOSE ================= -->
        <!-- Kept alive (hidden, not destroyed) so Back from the sign step
             returns to the form with all inputs intact -->
        <app-psbt-compose
          [class.view-hidden]="view() !== 'compose'"
          (created)="onComposed($event)"
          (cancelled)="view.set('start')"
        >
        </app-psbt-compose>

        <!-- ================= DOCUMENT (review / broadcast) ================= -->
        @if (view() === 'doc' && doc(); as document) {
          <!-- Document header — single compact row -->
          <div class="card">
            <div class="doc-head">
              @if (renaming()) {
                <mat-form-field appearance="outline" class="rename-field">
                  <input
                    matInput
                    [(ngModel)]="renameValue"
                    (keydown.enter)="commitRename()"
                    (keydown.escape)="renaming.set(false)"
                  />
                </mat-form-field>
                <button mat-icon-button (click)="commitRename()">
                  <mat-icon>check</mat-icon>
                </button>
              } @else {
                <h2>
                  {{ draftName() }}
                  <button mat-icon-button class="rename-button" (click)="startRename()">
                    <mat-icon>edit</mat-icon>
                  </button>
                </h2>
              }
              <div class="doc-meta mono">
                txid {{ shortId(document.unsignedTxid) }} · {{ document.sizeBytes }} bytes
              </div>
              <span
                class="badge"
                [class]="document.status"
                [matTooltip]="guidance(document)"
                matTooltipPosition="below"
              >
                <mat-icon>{{ statusIcon(document.status) }}</mat-icon>
                {{ statusLabel(document) }}
              </span>
            </div>

            <!-- Stats -->
            <div class="stats">
              <div class="stat">
                <div class="stat-key">{{ 'psbt_sending' | i18n }}</div>
                <div class="stat-value mono">
                  {{ document.sendingTotal | number: '1.8-8' }} <small>BTCX</small>
                </div>
              </div>
              <div class="stat">
                <div class="stat-key">{{ 'psbt_change' | i18n }}</div>
                <div class="stat-value mono">
                  {{ document.changeTotal | number: '1.8-8' }} <small>BTCX</small>
                </div>
              </div>
              <div class="stat">
                <div class="stat-key">{{ 'fee' | i18n }}</div>
                <div class="stat-value mono">
                  @if (document.fee !== undefined) {
                    {{ document.fee | number: '1.8-8' }} <small>BTCX</small>
                  } @else {
                    — <small>{{ 'psbt_unknown' | i18n }}</small>
                  }
                </div>
              </div>
              <div class="stat">
                <div class="stat-key">{{ 'psbt_fee_rate' | i18n }}</div>
                <div class="stat-value mono">
                  @if (document.feeRate !== undefined) {
                    {{ document.feeRate | number: '1.3-3' }}
                    <small>sat/vB · {{ document.vsize }} vB</small>
                  } @else {
                    — <small>{{ 'psbt_unknown' | i18n }}</small>
                  }
                </div>
              </div>
            </div>
          </div>

          <!-- Fee warning -->
          @if (feeWarning(); as warning) {
            <div class="warn-banner">
              <mat-icon>warning_amber</mat-icon>
              <div>
                <b>{{ 'psbt_high_fee' | i18n }}</b>
                {{ 'psbt_high_fee_detail' | i18n: { percent: warning.feePercent.toFixed(1) } }}
              </div>
            </div>
          }

          <!-- Inputs / outputs -->
          <div class="io-grid">
            <div class="card io-card">
              <div class="card-head">
                <h3 class="section-title">{{ 'psbt_inputs' | i18n }}</h3>
                <span class="section-aside">
                  {{ document.inputs.length }}
                  @if (document.totalInput !== undefined) {
                    · {{ document.totalInput | number: '1.8-8' }} BTCX
                  }
                </span>
              </div>
              @for (input of pagedInputs(); track input.index) {
                <div class="io-row">
                  <span class="io-index mono">#{{ input.index }}</span>
                  <div class="io-body">
                    <div class="io-addr mono">
                      {{ input.address ? shortAddr(input.address) : ('psbt_unknown' | i18n) }}
                    </div>
                    <div class="io-meta mono">
                      {{ shortId(input.txid) }}:{{ input.vout }}
                      @if (input.scriptType) {
                        · {{ input.scriptType }}
                      }
                    </div>
                  </div>
                  @if (input.amount !== undefined) {
                    <span class="io-amount mono">{{ input.amount | number: '1.8-8' }}</span>
                  }
                  <span class="io-status">
                    @if (input.satisfied) {
                      <mat-icon
                        class="ok"
                        [matTooltip]="
                          (input.isFinal ? 'psbt_input_final' : 'psbt_input_signed') | i18n
                        "
                        >check_circle</mat-icon
                      >
                    } @else if (input.sigCount > 0) {
                      <span
                        class="sig-count"
                        [matTooltip]="
                          'psbt_input_partial'
                            | i18n: { signed: input.sigCount, missing: input.missingSigs }
                        "
                        >{{
                          input.requiredSigs !== undefined
                            ? input.sigCount + '/' + input.requiredSigs
                            : input.sigCount
                        }}<mat-icon>draw</mat-icon></span
                      >
                    } @else {
                      <mat-icon class="wait" [matTooltip]="'psbt_input_unsigned' | i18n"
                        >pending</mat-icon
                      >
                    }
                  </span>
                </div>
              }
              @if (document.inputs.length > ioPageSize) {
                <div class="io-pager">
                  <button
                    mat-icon-button
                    [disabled]="inputPage() === 0"
                    (click)="inputPage.set(inputPage() - 1)"
                  >
                    <mat-icon>chevron_left</mat-icon>
                  </button>
                  <span class="pager-range mono">{{
                    ioRangeLabel(inputPage(), document.inputs.length)
                  }}</span>
                  <button
                    mat-icon-button
                    [disabled]="(inputPage() + 1) * ioPageSize >= document.inputs.length"
                    (click)="inputPage.set(inputPage() + 1)"
                  >
                    <mat-icon>chevron_right</mat-icon>
                  </button>
                </div>
              }
            </div>

            <div class="card io-card">
              <div class="card-head">
                <h3 class="section-title">{{ 'psbt_outputs' | i18n }}</h3>
                <span class="section-aside">{{ document.outputs.length }}</span>
              </div>
              @for (out of pagedOutputs(); track out.index) {
                <div class="io-row">
                  <span class="io-index mono">#{{ out.index }}</span>
                  <div class="io-body">
                    <div class="io-addr mono">
                      {{ out.kind === 'data' ? 'OP_RETURN' : shortAddr(out.address ?? '') }}
                      <span class="tag" [class]="out.kind">{{ outputTag(out) }}</span>
                    </div>
                    <div class="io-meta">{{ outputHint(out) }}</div>
                  </div>
                  <span class="io-amount mono">{{ out.amount | number: '1.8-8' }}</span>
                </div>
              }
              @if (document.outputs.length > ioPageSize) {
                <div class="io-pager">
                  <button
                    mat-icon-button
                    [disabled]="outputPage() === 0"
                    (click)="outputPage.set(outputPage() - 1)"
                  >
                    <mat-icon>chevron_left</mat-icon>
                  </button>
                  <span class="pager-range mono">{{
                    ioRangeLabel(outputPage(), document.outputs.length)
                  }}</span>
                  <button
                    mat-icon-button
                    [disabled]="(outputPage() + 1) * ioPageSize >= document.outputs.length"
                    (click)="outputPage.set(outputPage() + 1)"
                  >
                    <mat-icon>chevron_right</mat-icon>
                  </button>
                </div>
              }
            </div>
          </div>

          <!-- Notice: dust change folded into fee (derived from the PSBT itself) -->
          @if (document.changeAbsorbed) {
            <div class="notice-banner">
              <mat-icon>info</mat-icon>
              <span>{{ 'psbt_no_change_notice' | i18n }}</span>
            </div>
          }

          @if (!showBroadcastSection(document)) {
            <!-- Actions: sign / combine / join -->
            <div class="card">
              <div class="card-pad">
                <div class="card-head no-pad">
                  <h3 class="section-title">{{ 'psbt_actions' | i18n }}</h3>
                </div>
                <div class="actions">
                  <button
                    mat-raised-button
                    color="primary"
                    [disabled]="signing() || document.status === 'ready'"
                    [matTooltip]="'psbt_sign_tooltip' | i18n"
                    (click)="sign()"
                  >
                    @if (signing()) {
                      <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                    } @else {
                      <mat-icon>draw</mat-icon>
                    }
                    {{ 'psbt_sign_with_wallet' | i18n }}
                  </button>
                  <button
                    mat-stroked-button
                    [disabled]="combining()"
                    [matTooltip]="'psbt_combine_tooltip' | i18n"
                    (click)="combine()"
                  >
                    <mat-icon>call_merge</mat-icon>
                    {{ 'psbt_combine' | i18n }}
                  </button>
                  @if (!isRemote()) {
                    <span
                      class="tooltip-host"
                      [matTooltip]="
                        (document.status !== 'unsigned'
                          ? 'psbt_join_needs_unsigned'
                          : 'psbt_join_tooltip'
                        ) | i18n
                      "
                    >
                      <button
                        mat-stroked-button
                        [disabled]="joining() || document.status !== 'unsigned'"
                        (click)="join()"
                      >
                        <mat-icon>merge_type</mat-icon>
                        {{ 'psbt_join' | i18n }}
                      </button>
                    </span>
                  }
                  <span class="tooltip-host" [matTooltip]="'psbt_coming_soon' | i18n">
                    <button mat-stroked-button disabled>
                      <mat-icon>usb</mat-icon>
                      {{ 'psbt_sign_with_device' | i18n }}
                      <span class="soon-pill">{{ 'psbt_soon' | i18n }}</span>
                    </button>
                  </span>
                </div>
              </div>
            </div>
          } @else {
            <!-- Broadcast target -->
            <div class="card">
              <div class="card-pad">
                <div class="card-head no-pad">
                  <h3 class="section-title">{{ 'psbt_broadcast_via' | i18n }}</h3>
                </div>
                @if (!isRemote()) {
                  <div
                    class="target"
                    [class.selected]="broadcastTarget() === 'local'"
                    (click)="broadcastTarget.set('local')"
                    (keydown.enter)="broadcastTarget.set('local')"
                    tabindex="0"
                    role="radio"
                    [attr.aria-checked]="broadcastTarget() === 'local'"
                  >
                    <span class="radio" [class.checked]="broadcastTarget() === 'local'"></span>
                    <div class="target-body">
                      <div class="target-name">{{ 'psbt_target_local' | i18n }}</div>
                      <div class="target-hint">{{ 'psbt_target_local_hint' | i18n }}</div>
                    </div>
                    @if (broadcastTarget() === 'local') {
                      <mat-icon class="ok">check_circle</mat-icon>
                    }
                  </div>
                }
                @if (electrumAvailable()) {
                  <div
                    class="target"
                    [class.selected]="broadcastTarget() === 'electrum'"
                    (click)="broadcastTarget.set('electrum')"
                    (keydown.enter)="broadcastTarget.set('electrum')"
                    tabindex="0"
                    role="radio"
                    [attr.aria-checked]="broadcastTarget() === 'electrum'"
                  >
                    <span class="radio" [class.checked]="broadcastTarget() === 'electrum'"></span>
                    <div class="target-body">
                      <div class="target-name">Electrum</div>
                      <div class="target-hint">{{ 'psbt_target_electrum_ready' | i18n }}</div>
                    </div>
                    @if (broadcastTarget() === 'electrum') {
                      <mat-icon class="ok">check_circle</mat-icon>
                    }
                  </div>
                } @else {
                  <div class="target disabled">
                    <span class="radio"></span>
                    <div class="target-body">
                      <div class="target-name">
                        Electrum <span class="soon-pill">{{ 'psbt_soon' | i18n }}</span>
                      </div>
                      <div class="target-hint">{{ 'psbt_target_electrum_hint' | i18n }}</div>
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Error -->
          @if (docError()) {
            <div class="error-banner">
              <mat-icon>error</mat-icon>
              <span>{{ docError() }}</span>
            </div>
          }
        }

        <!-- Wizard navigation footer (mirrors mining/node setup wizards) -->
        @if (view() === 'doc' && doc(); as document) {
          <div class="wizard-footer">
            <button mat-stroked-button (click)="goBackStep()">
              <mat-icon>arrow_back</mat-icon>
              {{ 'psbt_back' | i18n }}
            </button>
            <button mat-stroked-button class="discard-button" (click)="discardDraft()">
              <mat-icon>delete_outline</mat-icon>
              {{ 'psbt_discard' | i18n }}
            </button>
            <button mat-stroked-button (click)="saveAndClose()">
              <mat-icon>save</mat-icon>
              {{ 'psbt_save_draft' | i18n }}
            </button>
            @if (showBroadcastSection(document)) {
              <!-- Finalized: the raw hex is the artifact worth exporting -->
              <button mat-stroked-button (click)="copyHex()">
                <mat-icon>content_copy</mat-icon>
                {{ 'psbt_copy_hex' | i18n }}
              </button>
              <button mat-stroked-button (click)="saveHexFile()">
                <mat-icon>download</mat-icon>
                {{ 'psbt_save_file' | i18n }}
              </button>
            } @else {
              <button mat-stroked-button (click)="copyBase64()">
                <mat-icon>content_copy</mat-icon>
                {{ 'psbt_copy_base64' | i18n }}
              </button>
              <button mat-stroked-button (click)="savePsbtFile()">
                <mat-icon>download</mat-icon>
                {{ 'psbt_save_file' | i18n }}
              </button>
            }
            <span class="spacer"></span>
            @if (showBroadcastSection(document)) {
              <button
                mat-raised-button
                class="broadcast-button"
                [disabled]="!finalHex() || broadcasting()"
                (click)="broadcast()"
              >
                @if (broadcasting()) {
                  <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                } @else {
                  <mat-icon>send</mat-icon>
                }
                {{ 'psbt_broadcast' | i18n }}
              </button>
            } @else if (document.status === 'finalized') {
              <!-- Stepped back on a finalized document: Next returns to broadcast -->
              <button mat-raised-button color="primary" (click)="docSection.set(null)">
                {{ 'psbt_next' | i18n }}
                <mat-icon iconPositionEnd>arrow_forward</mat-icon>
              </button>
            } @else {
              <span
                class="tooltip-host"
                [matTooltip]="
                  document.status !== 'ready' ? ('psbt_finalize_needs_sigs' | i18n) : ''
                "
              >
                <button
                  mat-raised-button
                  color="primary"
                  [disabled]="document.status !== 'ready' || finalizing()"
                  (click)="finalize()"
                >
                  @if (finalizing()) {
                    <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                  } @else {
                    <mat-icon>lock</mat-icon>
                  }
                  {{ 'psbt_finalize' | i18n }}
                </button>
              </span>
            }
          </div>
        }

        <!-- ================= SUCCESS ================= -->
        @if (view() === 'success') {
          <div class="success-card">
            <div class="success-icon"><mat-icon>check_circle</mat-icon></div>
            <h2>{{ 'psbt_broadcast_success' | i18n }}</h2>
            <p class="txid-label">{{ 'transaction_id' | i18n }}:</p>
            <app-address-display
              [address]="broadcastTxid()"
              [shortForm]="false"
              [showCopyButton]="true"
            >
            </app-address-display>
            <div class="success-buttons">
              <button mat-stroked-button [routerLink]="appMode.pageRoute('/transactions')">
                <mat-icon>history</mat-icon>
                {{ 'view_transactions' | i18n }}
              </button>
              <button mat-raised-button color="primary" (click)="reset()">
                <mat-icon>add</mat-icon>
                {{ 'psbt_start_another' | i18n }}
              </button>
            </div>
          </div>
        }

        @if (loadingDoc()) {
          <div class="loading-overlay"><mat-spinner diameter="40"></mat-spinner></div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .page-layout {
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }

      // Header — blue gradient like send page
      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;

          h1 {
            margin: 0;
            font-weight: 300;
            font-size: 24px;
          }

          .back-button {
            color: rgba(255, 255, 255, 0.9);

            &:hover {
              background: rgba(255, 255, 255, 0.1);
            }
          }
        }
      }

      // Narrow by default (start, broadcast); wide on compose and sign/finalize
      .content {
        padding: 24px;
        max-width: 648px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
        position: relative;

        &.wide {
          max-width: 980px;

          .stats {
            grid-template-columns: repeat(4, 1fr);
          }

          .io-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
      }

      @media (max-width: 900px) {
        .content.wide .stats {
          grid-template-columns: repeat(2, 1fr);
        }

        .content.wide .io-grid {
          grid-template-columns: 1fr;
        }
      }

      app-psbt-compose.view-hidden {
        display: none !important;
      }

      .card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        margin-bottom: 16px;
        overflow: hidden;
      }

      .card-pad {
        padding: 16px 20px;
      }

      .card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 20px 10px;

        &.no-pad {
          padding: 0 0 12px;
        }
      }

      .section-title {
        font-size: 13px;
        font-weight: 600;
        color: rgb(0, 35, 65);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0;
      }

      .section-aside {
        font-size: 11.5px;
        color: #6b7787;
      }

      .mono {
        font-family: 'Roboto Mono', monospace;
        letter-spacing: -0.3px;
      }

      // ============ Start (mode chooser, mirrors node-setup wizard) ============
      .start-column {
        width: 100%;
      }

      .options-card {
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .mode-option {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding: 16px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;

        &:hover,
        &:focus-visible {
          border-color: #1976d2;
          background: rgba(33, 150, 243, 0.08);

          .mode-icon {
            color: #1976d2;
          }
        }

        .mode-icon {
          color: rgba(0, 0, 0, 0.54);
          font-size: 28px;
          width: 28px;
          height: 28px;
          margin-top: 2px;
          flex-shrink: 0;
        }

        .mode-details {
          flex: 1;
        }

        .mode-title {
          font-weight: 500;
          font-size: 15px;
          color: rgba(0, 0, 0, 0.87);
          margin-bottom: 4px;
        }

        .mode-desc {
          font-size: 13px;
          color: rgba(0, 0, 0, 0.6);
          line-height: 1.4;
        }
      }

      // ============ Drafts list ============
      .draft-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 20px;
        cursor: pointer;
        border-top: 1px solid #e6ebf1;

        // Fixed badge column so draft names align like a table
        .badge {
          width: 148px;
          justify-content: center;
          flex-shrink: 0;
          box-sizing: border-box;
        }

        &:hover {
          background: rgba(0, 0, 0, 0.03);
        }

        .draft-body {
          flex: 1;
          min-width: 0;
        }

        .draft-name {
          font-size: 13.5px;
          font-weight: 600;
          color: rgb(0, 35, 65);
        }

        .draft-meta {
          font-size: 11.5px;
          color: #6b7787;
        }

        .draft-chevron {
          color: #9aa7b5;
        }

        .draft-delete {
          opacity: 0.5;

          &:hover {
            opacity: 1;
            color: #f44336;
          }
        }
      }

      // ============ Badges ============
      .badge {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 5px 12px;
        border-radius: 20px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;

        mat-icon {
          font-size: 15px;
          width: 15px;
          height: 15px;
        }

        &.unsigned {
          background: #eceff1;
          color: #607d8b;
        }

        &.partial {
          background: rgba(255, 152, 0, 0.16);
          color: #e65100;
        }

        &.ready {
          background: rgba(25, 118, 210, 0.14);
          color: #1976d2;
        }

        &.finalized {
          background: rgba(76, 175, 80, 0.16);
          color: #2e7d32;
        }
      }

      // ============ Document header — one compact row ============
      .doc-head {
        padding: 10px 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;

        h2 {
          font-size: 16px;
          color: rgb(0, 35, 65);
          font-weight: 600;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .rename-button {
          width: 26px;
          height: 26px;
          padding: 0;

          mat-icon {
            font-size: 15px;
            width: 15px;
            height: 15px;
            color: #9aa7b5;
          }

          &:hover mat-icon {
            color: #1976d2;
          }
        }

        .rename-field {
          width: 260px;
        }

        .doc-meta {
          font-size: 11px;
          color: #6b7787;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      // ============ Step indicator (mirrors mining setup wizard) ============
      .step-indicator {
        display: flex;
        align-items: center;
        margin: 0 0 16px;
        padding: 12px 16px;
        background: #ffffff;
        border-radius: 6px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
        box-sizing: border-box;
      }

      .step {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .step-circle {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        background: #e0e0e0;
        color: #9e9e9e;
        flex-shrink: 0;

        &.active {
          background: #1976d2;
          color: white;
        }

        &.complete {
          background: #4caf50;
          color: white;
        }
      }

      .step-label {
        font-size: 12px;
        color: #666666;
        white-space: nowrap;

        &.active {
          color: rgb(0, 35, 65);
          font-weight: 500;
        }
      }

      .step-line {
        flex: 1;
        height: 2px;
        background: #e0e0e0;
        margin: 0 10px;
        min-width: 12px;

        &.complete {
          background: #4caf50;
        }
      }

      .drafts-empty {
        text-align: center;
        padding: 24px 20px 28px;
        color: rgba(0, 0, 0, 0.45);

        mat-icon {
          font-size: 36px;
          width: 36px;
          height: 36px;
          opacity: 0.4;
        }

        p {
          margin: 8px 0 0;
          font-size: 12.5px;
        }
      }

      // ============ Stats ============
      .stats {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1px;
        background: #e6ebf1;
        border-top: 1px solid #e6ebf1;
      }

      .stat {
        background: #fff;
        padding: 8px 16px;

        .stat-key {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: #6b7787;
          margin-bottom: 2px;
        }

        .stat-value {
          font-size: 14px;
          font-weight: 600;
          color: rgb(0, 35, 65);

          small {
            font-size: 10.5px;
            color: #6b7787;
            font-weight: 500;
            font-family: 'Montserrat', sans-serif;
          }
        }
      }

      // ============ I/O ============
      .io-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
        margin-bottom: 16px;

        .io-card {
          margin-bottom: 0;
        }
      }

      .io-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 20px;
        border-top: 1px solid #e6ebf1;

        .io-index {
          font-size: 10.5px;
          color: #9aa7b5;
          width: 22px;
          flex-shrink: 0;
        }

        .io-body {
          flex: 1;
          min-width: 0;
        }

        .io-addr {
          font-size: 12.5px;
          color: rgb(0, 35, 65);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .io-meta {
          font-size: 10.5px;
          color: #6b7787;
        }

        .io-amount {
          font-size: 13px;
          font-weight: 600;
          color: rgb(0, 35, 65);
          white-space: nowrap;
        }

        .io-status {
          width: 30px;
          text-align: center;
          flex-shrink: 0;

          .ok {
            color: #4caf50;
          }

          .wait {
            color: #ff9800;
          }

          .sig-count {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            font-size: 12px;
            font-weight: 600;
            color: #e65100;

            mat-icon {
              font-size: 15px;
              width: 15px;
              height: 15px;
            }
          }
        }
      }

      .io-pager {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        padding: 4px 12px 8px;
        border-top: 1px solid #e6ebf1;

        .pager-range {
          font-size: 11px;
          color: #6b7787;
        }

        button {
          width: 32px;
          height: 32px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
      }

      .tag {
        display: inline-flex;
        align-items: center;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: 6px;
        vertical-align: middle;

        &.external {
          background: rgba(76, 175, 80, 0.12);
          color: #2e7d32;
        }

        &.mine {
          background: rgba(25, 118, 210, 0.1);
          color: #1976d2;
        }

        &.change {
          background: rgba(25, 118, 210, 0.1);
          color: #1976d2;
        }

        &.data {
          background: #ede7f6;
          color: #5e35b1;
        }
      }

      // ============ Actions ============
      .actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 12px;

        .spacer {
          flex: 1;
        }

        button mat-icon {
          margin-right: 6px;
        }

        .button-spinner {
          display: inline-block;
          margin-right: 8px;
        }
      }

      // Wizard navigation footer
      .wizard-footer {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 16px;
        margin-bottom: 24px;

        .spacer {
          flex: 1;
        }

        button {
          min-width: 110px;

          mat-icon {
            margin-right: 6px;

            &[iconPositionEnd] {
              margin-right: 0;
              margin-left: 6px;
            }
          }

          .button-spinner {
            display: inline-block;
            margin-right: 8px;
          }
        }
      }

      .broadcast-button {
        background: #4caf50 !important;
        color: white !important;

        &:disabled {
          background: rgba(0, 0, 0, 0.12) !important;
          color: rgba(0, 0, 0, 0.38) !important;
        }
      }

      // Wrapper so tooltips work on disabled buttons (no mouse events there)
      .tooltip-host {
        display: inline-flex;
      }

      .soon-pill {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        background: #f5f7fa;
        color: #9aa7b5;
        border-radius: 8px;
        padding: 1px 6px;
        margin-left: 6px;
      }

      // ============ Broadcast target ============
      .target {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        border: 1px solid #e6ebf1;
        border-radius: 6px;
        margin-top: 8px;

        &:not(.disabled) {
          cursor: pointer;
        }

        &.selected {
          border-color: #1976d2;
          background: rgba(25, 118, 210, 0.04);
        }

        &.disabled {
          opacity: 0.55;
        }

        .radio {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 2px solid #cdd6e0;
          flex-shrink: 0;
          position: relative;
          box-sizing: border-box;

          &.checked {
            border-color: #1976d2;

            &::after {
              content: '';
              position: absolute;
              inset: 3px;
              border-radius: 50%;
              background: #1976d2;
            }
          }
        }

        .target-body {
          flex: 1;
        }

        .target-name {
          font-size: 13px;
          font-weight: 600;
          color: rgb(0, 35, 65);
        }

        .target-hint {
          font-size: 11px;
          color: #6b7787;
        }

        .ok {
          color: #4caf50;
        }
      }

      // ============ Banners ============
      .warn-banner {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
        background: #fff3e0;
        border-radius: 6px;
        color: #e65100;
        font-size: 12.5px;
        margin-bottom: 16px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          margin-top: 1px;
          flex-shrink: 0;
        }
      }

      .error-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: #ffebee;
        color: #c62828;
        border-radius: 4px;
        margin-bottom: 16px;

        mat-icon {
          flex-shrink: 0;
        }
      }

      .notice-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: #fff3e0;
        color: #e65100;
        border-radius: 4px;
        margin-bottom: 16px;

        mat-icon {
          flex-shrink: 0;
        }
      }

      // ============ Success ============
      .success-card {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        max-width: 500px;
        margin: 0 auto;
        padding: 48px 24px;
        text-align: center;

        .success-icon mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          color: #4caf50;
        }

        h2 {
          margin: 16px 0;
          color: rgb(0, 35, 65);
        }

        .txid-label {
          color: rgba(0, 0, 0, 0.54);
          margin: 16px 0 8px;
        }

        .success-buttons {
          display: flex;
          gap: 16px;
          justify-content: center;
          margin-top: 24px;

          button {
            min-width: 150px;

            mat-icon {
              margin-right: 6px;
            }
          }
        }
      }

      .loading-overlay {
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 5;
      }

      // ============ Dark theme ============
      :host-context(.dark-theme) {
        .card,
        .success-card,
        .step-indicator {
          background: #424242;
        }

        .step-label.active {
          color: #fff;
        }

        .stat {
          background: #424242;
        }

        .stats {
          background: #555;
          border-top-color: #555;
        }

        .section-title,
        .doc-id h2,
        .draft-name,
        .mode-title,
        .io-addr,
        .io-amount,
        .stat-value,
        .target-name,
        h2 {
          color: #ffffff !important;
        }

        .mode-option {
          border-color: #555;

          .mode-icon {
            color: rgba(255, 255, 255, 0.54);
          }

          .mode-desc {
            color: rgba(255, 255, 255, 0.6);
          }
        }

        .io-row,
        .draft-row {
          border-top-color: #555;
        }

        .target {
          border-color: #555;
        }

        .warn-banner {
          background: #4a3000;
        }

        .error-banner {
          background: #4a0000;
          color: #ff8a80;
        }

        .notice-banner {
          background: #4a3000;
          color: #ffcc80;
        }

        .soon-pill {
          background: #333;
        }
      }

      // ============ Responsive ============
      @media (max-width: 600px) {
        .content {
          padding: 16px;
        }

        .actions button {
          flex: 1 1 auto;
        }

        .success-buttons {
          flex-direction: column;

          button {
            width: 100%;
          }
        }
      }
    `,
  ],
})
export class PsbtComponent implements OnInit {
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletService = inject(WalletService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly btcxWallet = inject(BtcxWalletService);
  private readonly electron = inject(ElectronService);
  private readonly psbtService = inject(PsbtService);
  private readonly notification = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly i18n = inject(I18nService);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  readonly appMode = inject(AppModeService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store);
  private readonly nodeService = inject(NodeService);
  readonly network = toSignal(this.store.select(selectNetwork), { initialValue: 'mainnet' });

  /** Remote (Electrum) mode: client-side PSBT ops, Electrum-only broadcast. */
  readonly isRemote = this.nodeService.isRemote;

  readonly view = signal<PsbtView>('start');
  readonly doc = signal<PsbtDocument | null>(null);
  readonly draft = signal<PsbtDraft | null>(null);
  readonly drafts = signal<PsbtDraft[]>([]);
  readonly finalHex = signal<string | null>(null);
  readonly broadcastTxid = signal('');

  readonly loadingDoc = signal(false);
  readonly signing = signal(false);
  readonly combining = signal(false);
  readonly joining = signal(false);
  readonly finalizing = signal(false);
  readonly broadcasting = signal(false);
  readonly docError = signal<string | null>(null);

  /** Broadcast target: the local Core node (default) or an Electrum server */
  readonly broadcastTarget = signal<'local' | 'electrum'>('local');

  /**
   * Whether the Electrum target is usable: at least one Electrum server is
   * configured for the current network in the nodeless wallet config.
   */
  readonly electrumAvailable = computed(
    () => this.btcxWallet.serversFor(this.network()).length > 0
  );

  readonly renaming = signal(false);
  renameValue = '';

  readonly ioPageSize = 5;
  readonly inputPage = signal(0);
  readonly outputPage = signal(0);

  readonly pagedInputs = computed(() => {
    const document = this.doc();
    if (!document) return [];
    const start = this.inputPage() * this.ioPageSize;
    return document.inputs.slice(start, start + this.ioPageSize);
  });

  readonly pagedOutputs = computed(() => {
    const document = this.doc();
    if (!document) return [];
    const start = this.outputPage() * this.ioPageSize;
    return document.outputs.slice(start, start + this.ioPageSize);
  });

  ioRangeLabel(page: number, total: number): string {
    const start = page * this.ioPageSize + 1;
    const end = Math.min(total, start + this.ioPageSize - 1);
    return `${start}–${end} / ${total}`;
  }

  /** Lifecycle steps shown in the wizard-style indicator */
  readonly steps = [
    'psbt_step_create',
    'psbt_step_sign',
    'psbt_step_finalize',
    'psbt_step_broadcast',
  ];

  /** Index of the furthest lifecycle step reached; 4 = everything done (broadcast) */
  readonly currentStep = computed(() => {
    if (this.view() === 'success') return 4;
    const document = this.doc();
    if (this.view() === 'doc' && document) {
      switch (document.status) {
        case 'ready':
          return 2;
        case 'finalized':
          return 3;
        default:
          return 1;
      }
    }
    return 0;
  });

  /**
   * Section override for the document view: on a finalized PSBT the user can
   * click back to the Sign step to see signatures & export again.
   */
  readonly docSection = signal<'sign' | 'broadcast' | null>(null);

  /** The step the user is currently looking at (can trail currentStep) */
  readonly viewedStep = computed(() => {
    if (this.view() === 'success') return 4;
    const document = this.doc();
    if (this.view() === 'doc' && document) {
      if (document.status === 'finalized') {
        return this.docSection() === 'sign' ? 1 : 3;
      }
      return document.status === 'ready' ? 2 : 1;
    }
    // Start page is "step 0" — nothing begun yet, no step highlighted
    return this.view() === 'compose' ? 0 : -1;
  });

  showBroadcastSection(document: PsbtDocument): boolean {
    return document.status === 'finalized' && this.docSection() !== 'sign';
  }

  /** How the current document entered the page — decides where Back leads */
  readonly docOrigin = signal<'compose' | 'import' | 'draft'>('compose');

  @ViewChild(PsbtComposeComponent) private composeForm?: PsbtComposeComponent;

  /** Start a fresh composition (drops any stale document reference) */
  startCompose(): void {
    this.doc.set(null);
    this.draft.set(null);
    this.finalHex.set(null);
    this.docSection.set(null);
    this.view.set('compose');
  }

  /**
   * Wizard Back. On a finalized document's broadcast view: step back to the
   * signatures & export section. On any non-finalized document: back to the
   * compose form to edit inputs/outputs — freshly composed transactions keep
   * the live form state, drafts and imports get the form prefilled from the
   * PSBT. Editing a signed document requires confirming the loss of the
   * collected signatures. Finalized documents cannot be edited.
   */
  async goBackStep(): Promise<void> {
    const document = this.doc();
    if (document && this.showBroadcastSection(document)) {
      this.docSection.set('sign');
      return;
    }
    this.docSection.set(null);
    if (this.view() === 'doc' && document && document.status !== 'finalized') {
      if (document.status !== 'unsigned') {
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: this.i18n.get('psbt_edit_signed_title'),
            message: this.i18n.get('psbt_edit_signed_message'),
            confirmText: this.i18n.get('psbt_edit_signed_confirm'),
            type: 'warning',
          },
        });
        const confirmed = await firstValueFrom(dialogRef.afterClosed());
        if (!confirmed) return;
      }
      if (this.docOrigin() !== 'compose') {
        await this.composeForm?.prefill(document, this.draft()?.autoCoins ?? false);
      }
      this.view.set('compose');
      return;
    }
    this.view.set('start');
    this.refreshDrafts();
  }

  /** " 1/2" suffix on the Sign step while a document is open — signatures when countable, inputs otherwise */
  readonly signProgress = computed(() => {
    const document = this.doc();
    if (!document || this.view() !== 'doc') return '';
    if (document.sigsRequired) {
      return ` ${document.sigsCollected}/${document.sigsRequired}`;
    }
    return ` ${document.satisfiedInputs}/${document.inputs.length}`;
  });

  readonly draftName = computed(() => this.draft()?.name ?? this.i18n.get('psbt_untitled'));

  /**
   * Compose and the whole document view (incl. broadcast, which keeps the
   * inputs/outputs visible for a final review) use the wide layout; only
   * the start page and the success screen stay narrow.
   */
  readonly wideLayout = computed(() => this.view() === 'compose' || this.view() === 'doc');
  readonly feeWarning = computed(() => {
    const document = this.doc();
    return document ? this.psbtService.checkFee(document) : null;
  });

  // ============================================================
  // Browser-history integration: each step is a history entry, so
  // mouse/keyboard back-forward navigates the wizard, and backing out
  // of the first step leaves the page naturally.
  // ============================================================

  /** Mirrors view/section into the URL whenever they change */
  private readonly urlSync = effect(() => {
    const view = this.view();
    const section = this.docSection() === 'sign' ? 'sign' : null;
    const current = this.route.snapshot.queryParamMap;
    const desiredView = view === 'start' ? null : view;
    if (current.get('view') === desiredView && current.get('section') === section) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: desiredView, section },
      // Success replaces the broadcast entry — back should not re-arm it
      replaceUrl: view === 'success',
    });
  });

  /** Applies popstate (browser back/forward) to the wizard state */
  private applyUrlState(view: string | null, section: string | null): void {
    const urlView = (view ?? 'start') as PsbtView;
    const urlSection = section === 'sign' ? 'sign' : null;
    if (urlView === this.view() && urlSection === (this.docSection() === 'sign' ? 'sign' : null)) {
      return;
    }
    switch (urlView) {
      case 'doc':
        if (this.doc()) {
          this.docSection.set(urlSection);
          this.view.set('doc');
        } else {
          // Stale deep link (e.g. reload) — no document in memory
          this.view.set('start');
          this.refreshDrafts();
        }
        break;
      case 'compose': {
        const document = this.doc();
        if (document?.status === 'finalized') {
          // Finalized transactions cannot be edited — skip past compose
          this.view.set('start');
          this.refreshDrafts();
          break;
        }
        if (document && this.docOrigin() !== 'compose') {
          void this.composeForm?.prefill(document, this.draft()?.autoCoins ?? false);
        }
        this.view.set('compose');
        break;
      }
      case 'success':
        this.view.set(this.broadcastTxid() ? 'success' : 'start');
        break;
      default:
        this.view.set('start');
        this.refreshDrafts();
    }
  }

  ngOnInit(): void {
    this.refreshDrafts();
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => this.applyUrlState(params.get('view'), params.get('section')));

    // Load the btcx wallet config so the Electrum broadcast target knows
    // whether a server is configured for this network (a cheap config read
    // — no seed or open wallet required)
    if (this.electron.isDesktop) {
      void this.btcxWallet.refreshConfig();
    }

    // Remote mode has no local node: Electrum is the only broadcast target.
    if (this.isRemote()) {
      this.broadcastTarget.set('electrum');
    }
  }

  goBack(): void {
    if (this.view() === 'doc' || this.view() === 'compose') {
      this.view.set('start');
      this.refreshDrafts();
      return;
    }
    this.location.back();
  }

  refreshDrafts(): void {
    this.drafts.set(this.psbtService.listDrafts(this.network()));
  }

  // ============================================================
  // Entry points
  // ============================================================

  async onComposed(event: { psbt: string; fee: number }): Promise<void> {
    this.docOrigin.set('compose');
    await this.loadDocument(event.psbt, true);
    // Remember the coin-selection mode so editing later restores it
    const draft = this.draft();
    if (draft) {
      const updated = { ...draft, autoCoins: !(this.composeForm?.manualCoins() ?? false) };
      this.draft.set(updated);
      this.psbtService.saveDraft(updated);
    }
  }

  async importPsbt(): Promise<void> {
    const dialogRef = this.dialog.open(PsbtImportDialogComponent, {
      width: '520px',
      data: { titleKey: 'psbt_door_import' },
    });
    const base64: string | undefined = await firstValueFrom(dialogRef.afterClosed());
    if (base64) {
      this.docOrigin.set('import');
      this.draft.set(null);
      this.finalHex.set(null);
      await this.loadDocument(base64, true);
    }
  }

  async openDraft(draft: PsbtDraft): Promise<void> {
    this.docOrigin.set('draft');
    this.draft.set(draft);
    this.finalHex.set(draft.finalHex ?? null);
    await this.loadDocument(draft.psbt, false);
  }

  private async loadDocument(base64: string, createDraft: boolean): Promise<void> {
    this.loadingDoc.set(true);
    this.docError.set(null);
    this.docSection.set(null);
    this.inputPage.set(0);
    this.outputPage.set(0);
    try {
      const document = await this.psbtService.buildDocument(base64);
      this.doc.set(document);
      if (createDraft) {
        this.finalHex.set(null);
        const existing = this.draft();
        if (existing && this.docOrigin() === 'compose') {
          // Recomposed after Back: replace the draft's transaction, keep its identity
          const updated: PsbtDraft = {
            ...existing,
            psbt: document.base64,
            status: document.status,
            amountLabel: `${document.sendingTotal.toFixed(8)} BTCX`,
            finalHex: undefined,
            updatedAt: Date.now(),
          };
          this.draft.set(updated);
          this.psbtService.saveDraft(updated);
        } else {
          const draft = this.psbtService.createDraft(this.network(), document.base64, document);
          this.draft.set(draft);
          this.psbtService.saveDraft(draft);
        }
      }
      this.view.set('doc');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notification.error(`${this.i18n.get('psbt_decode_failed')}: ${message}`);
    } finally {
      this.loadingDoc.set(false);
    }
  }

  private syncDraft(): void {
    const document = this.doc();
    const draft = this.draft();
    if (!document || !draft) return;
    const updated: PsbtDraft = {
      ...draft,
      psbt: document.base64,
      status: document.status,
      amountLabel: `${document.sendingTotal.toFixed(8)} BTCX`,
      finalHex: this.finalHex() ?? undefined,
      updatedAt: Date.now(),
    };
    this.draft.set(updated);
    this.psbtService.saveDraft(updated);
  }

  // ============================================================
  // Lifecycle actions
  // ============================================================

  async sign(): Promise<void> {
    const document = this.doc();
    const walletName = this.walletManager.activeWallet;
    if (!document || !walletName || this.signing()) return;

    this.signing.set(true);
    this.docError.set(null);
    try {
      if (!this.isRemote()) {
        const info = await this.walletRpc.getWalletInfo(walletName);
        if (info.private_keys_enabled === false) {
          this.docError.set(this.i18n.get('psbt_watch_only_cannot_sign'));
          return;
        }
      }
      if (!(await this.ensureWalletUnlocked(walletName))) return;
      const sigsBefore = document.sigsCollected;
      // finalize=false keeps sealing an explicit, separate step (the
      // client-side signer leaves foreign inputs untouched too)
      const result = this.isRemote()
        ? await this.btcxWallet.psbtProcess(document.base64)
        : await this.walletRpc.walletProcessPsbt(
            walletName,
            document.base64,
            true,
            'ALL',
            true,
            false
          );
      // walletprocesspsbt also acts as an updater (adds derivation/UTXO
      // data), so a changed string does NOT prove a signature was added —
      // compare actual signature counts instead.
      const updated = await this.psbtService.buildDocument(result.psbt);
      this.doc.set(updated);
      this.syncDraft();
      if (updated.sigsCollected > sigsBefore || result.complete) {
        this.notification.success(this.i18n.get('psbt_signed'));
      } else if (document.status === 'ready') {
        this.notification.info(this.i18n.get('psbt_already_signed'));
      } else {
        console.debug('PSBT sign added no signatures', { result, updated });
        this.notification.warning(this.i18n.get('psbt_no_sigs_added'));
      }
    } catch (error) {
      this.docError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.signing.set(false);
    }
  }

  /**
   * Join a distinct part-transaction (different inputs/outputs) into this one —
   * collaborative spend / CoinJoin construction. Both sides must be unsigned:
   * with SIGHASH_ALL, joining after signing would invalidate every signature.
   */
  async join(): Promise<void> {
    const document = this.doc();
    if (!document || this.joining()) return;

    const dialogRef = this.dialog.open(PsbtImportDialogComponent, {
      width: '520px',
      data: { titleKey: 'psbt_join' },
    });
    const other: string | undefined = await firstValueFrom(dialogRef.afterClosed());
    if (!other) return;

    this.joining.set(true);
    this.docError.set(null);
    try {
      const otherDoc = await this.psbtService.buildDocument(other);
      if (document.status !== 'unsigned' || otherDoc.status !== 'unsigned') {
        this.docError.set(this.i18n.get('psbt_join_signed'));
        return;
      }
      if (this.isRemote()) {
        // joinpsbts has no client-side implementation (yet).
        this.docError.set(this.i18n.get('psbt_join_unavailable_remote'));
        return;
      }
      const joined = await this.walletRpc.joinPsbts([document.base64, other]);
      this.doc.set(await this.psbtService.buildDocument(joined));
      this.syncDraft();
      this.notification.success(this.i18n.get('psbt_joined'));
    } catch (error) {
      this.docError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.joining.set(false);
    }
  }

  async combine(): Promise<void> {
    const document = this.doc();
    if (!document || this.combining()) return;

    const dialogRef = this.dialog.open(PsbtImportDialogComponent, {
      width: '520px',
      data: { titleKey: 'psbt_combine' },
    });
    const other: string | undefined = await firstValueFrom(dialogRef.afterClosed());
    if (!other) return;

    this.combining.set(true);
    this.docError.set(null);
    try {
      const combined = this.isRemote()
        ? await this.btcxWallet.psbtCombine([document.base64, other])
        : await this.walletRpc.combinePsbt([document.base64, other]);
      this.doc.set(await this.psbtService.buildDocument(combined));
      this.syncDraft();
      this.notification.success(this.i18n.get('psbt_combined'));
    } catch (error) {
      this.docError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.combining.set(false);
    }
  }

  async finalize(): Promise<void> {
    const document = this.doc();
    if (!document || this.finalizing()) return;

    this.finalizing.set(true);
    this.docError.set(null);
    try {
      if (this.isRemote()) {
        // Client-side finalize returns PSBT + raw hex in one step.
        const result = await this.btcxWallet.psbtFinalize(document.base64);
        if (!result.complete || !result.hex) {
          this.docError.set(this.i18n.get('psbt_finalize_incomplete'));
          return;
        }
        this.finalHex.set(result.hex);
        this.docSection.set(null);
        this.doc.set(await this.psbtService.buildDocument(result.psbt));
        this.syncDraft();
        this.notification.success(this.i18n.get('psbt_finalized_ok'));
        return;
      }

      const result = await this.walletRpc.finalizePsbt(document.base64, false);
      if (!result.complete || !result.psbt) {
        this.docError.set(this.i18n.get('psbt_finalize_incomplete'));
        return;
      }
      const extracted = await this.walletRpc.finalizePsbt(result.psbt, true);
      if (!extracted.hex) {
        this.docError.set(this.i18n.get('psbt_finalize_incomplete'));
        return;
      }
      this.finalHex.set(extracted.hex);
      this.docSection.set(null);
      this.doc.set(await this.psbtService.buildDocument(result.psbt));
      this.syncDraft();
      this.notification.success(this.i18n.get('psbt_finalized_ok'));
    } catch (error) {
      this.docError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.finalizing.set(false);
    }
  }

  async broadcast(): Promise<void> {
    const hex = this.finalHex();
    if (!hex || this.broadcasting()) return;

    this.broadcasting.set(true);
    this.docError.set(null);
    try {
      let txid: string;
      if (this.broadcastTarget() === 'electrum' && this.electrumAvailable()) {
        // Chain-only Electrum broadcast: no local node (and no node wallet)
        // involved. Rejection reasons come back from the server's node.
        txid = await this.btcxWallet.broadcastTx(hex, this.network());
      } else {
        // Preflight: catches already-broadcast and policy rejections without sending
        const [check] = await this.blockchainRpc.testMempoolAccept([hex]);
        if (check && !check.allowed) {
          const reason = check['reject-reason'] ?? '';
          if (reason.includes('already') || reason.includes('txn-known')) {
            this.docError.set(this.i18n.get('psbt_already_broadcast'));
          } else {
            this.docError.set(`${this.i18n.get('psbt_rejected')}: ${reason}`);
          }
          return;
        }
        txid = await this.blockchainRpc.sendRawTransaction(hex);
        // Only the local path implies a reachable Core wallet to refresh
        this.walletService.refresh();
      }
      this.broadcastTxid.set(txid);
      const draft = this.draft();
      if (draft) this.psbtService.deleteDraft(draft.id);
      this.view.set('success');
      this.notification.success(this.i18n.get('psbt_broadcast_success'));
    } catch (error) {
      this.docError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.broadcasting.set(false);
    }
  }

  // ============================================================
  // Export & sharing
  // ============================================================

  async copyBase64(): Promise<void> {
    const document = this.doc();
    if (!document) return;
    await navigator.clipboard.writeText(document.base64);
    this.notification.success(this.i18n.get('psbt_copied'));
  }

  async copyHex(): Promise<void> {
    const hex = this.finalHex();
    if (!hex) return;
    await navigator.clipboard.writeText(hex);
    this.notification.success(this.i18n.get('psbt_copied'));
  }

  async savePsbtFile(): Promise<void> {
    const document = this.doc();
    if (!document) return;
    try {
      await this.psbtService.savePsbtFile(this.fileBaseName(), document.base64);
    } catch (err) {
      console.error('Failed to save PSBT file:', err);
    }
  }

  async saveHexFile(): Promise<void> {
    const hex = this.finalHex();
    if (!hex) return;
    try {
      await this.psbtService.saveHexFile(this.fileBaseName(), hex);
    } catch (err) {
      console.error('Failed to save transaction file:', err);
    }
  }

  private fileBaseName(): string {
    return (this.draft()?.name ?? 'transaction').replace(/[^\w-]+/g, '_').toLowerCase();
  }

  // ============================================================
  // Draft management
  // ============================================================

  startRename(): void {
    this.renameValue = this.draftName();
    this.renaming.set(true);
  }

  commitRename(): void {
    const draft = this.draft();
    const name = this.renameValue.trim();
    this.renaming.set(false);
    if (!draft || !name) return;
    const updated = { ...draft, name, updatedAt: Date.now() };
    this.draft.set(updated);
    this.psbtService.saveDraft(updated);
  }

  /** Save the current document as a draft and return to the start page */
  saveAndClose(): void {
    this.syncDraft();
    this.docSection.set(null);
    this.view.set('start');
    this.refreshDrafts();
    this.notification.success(this.i18n.get('psbt_draft_saved'));
  }

  async discardDraft(): Promise<void> {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.i18n.get('psbt_discard'),
        message: this.i18n.get('psbt_discard_confirm'),
        confirmText: this.i18n.get('psbt_discard'),
        type: 'danger',
      },
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) return;
    const draft = this.draft();
    if (draft) this.psbtService.deleteDraft(draft.id);
    this.reset();
  }

  async deleteDraft(draft: PsbtDraft): Promise<void> {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.i18n.get('psbt_delete_draft'),
        message: this.i18n.get('psbt_discard_confirm'),
        confirmText: this.i18n.get('psbt_delete_draft'),
        type: 'danger',
      },
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) return;
    this.psbtService.deleteDraft(draft.id);
    this.refreshDrafts();
  }

  reset(): void {
    this.doc.set(null);
    this.draft.set(null);
    this.docSection.set(null);
    this.finalHex.set(null);
    this.broadcastTxid.set('');
    this.docError.set(null);
    this.view.set('start');
    this.refreshDrafts();
  }

  // ============================================================
  // Display helpers
  // ============================================================

  statusIcon(status: string): string {
    switch (status) {
      case 'partial':
        return 'hourglass_top';
      case 'ready':
        return 'task_alt';
      case 'finalized':
        return 'verified';
      default:
        return 'edit';
    }
  }

  statusLabel(document: PsbtDocument): string {
    if (document.status === 'partial') {
      // Count signatures when every input's requirement is known (the normal
      // coordination flow); otherwise fall back to satisfied-input counts.
      if (document.sigsRequired !== undefined) {
        return this.i18n.get('psbt_status_partial_sigs', {
          collected: document.sigsCollected,
          required: document.sigsRequired,
        });
      }
      return this.i18n.get('psbt_status_partial_n', {
        signed: document.satisfiedInputs,
        total: document.inputs.length,
      });
    }
    return this.i18n.get(`psbt_status_${document.status}`);
  }

  guidance(document: PsbtDocument): string {
    switch (document.status) {
      case 'unsigned':
        return this.i18n.get('psbt_guide_unsigned');
      case 'partial':
        return this.i18n.get('psbt_guide_partial');
      case 'ready':
        return this.i18n.get('psbt_guide_ready');
      case 'finalized':
        return this.i18n.get('psbt_guide_finalized');
    }
  }

  outputTag(out: PsbtOutputView): string {
    switch (out.kind) {
      case 'change':
        return this.i18n.get('psbt_tag_change');
      case 'mine':
        return this.i18n.get('psbt_tag_mine');
      case 'data':
        return this.i18n.get('psbt_tag_data');
      default:
        return this.i18n.get('psbt_tag_recipient');
    }
  }

  outputHint(out: PsbtOutputView): string {
    switch (out.kind) {
      case 'change':
        return this.i18n.get('psbt_hint_change');
      case 'mine':
        return this.i18n.get('psbt_hint_mine');
      case 'data':
        return this.i18n.get('psbt_hint_data');
      default:
        return this.i18n.get('psbt_hint_external');
    }
  }

  shortAddr(address: string): string {
    if (!address || address.length <= 26) return address;
    return `${address.slice(0, 16)}…${address.slice(-8)}`;
  }

  shortId(id: string): string {
    return `${id.slice(0, 8)}…${id.slice(-4)}`;
  }

  private async ensureWalletUnlocked(walletName: string): Promise<boolean> {
    if (this.isRemote()) {
      // Local wallet: only a passphrase-encrypted seed can be locked.
      const status = await this.btcxWallet.refreshStatus();
      if (status?.seed !== 'locked') return true;
      const dialogRef = this.dialog.open(PassphraseDialogComponent, {
        width: '400px',
        data: { walletName, timeout: 60 },
      });
      const result: PassphraseDialogResult | null = await firstValueFrom(dialogRef.afterClosed());
      if (!result) return false;
      await this.btcxWallet.unlock(result.passphrase);
      return true;
    }

    const info = await this.walletRpc.getWalletInfo(walletName);
    if (info.unlocked_until === undefined || info.unlocked_until > 0) {
      return true; // not encrypted, or already unlocked
    }
    const dialogRef = this.dialog.open(PassphraseDialogComponent, {
      width: '400px',
      data: { walletName, timeout: 60 },
    });
    const result: PassphraseDialogResult | null = await firstValueFrom(dialogRef.afterClosed());
    if (!result) return false;
    await this.walletRpc.walletPassphrase(walletName, result.passphrase, result.timeout);
    return true;
  }
}
