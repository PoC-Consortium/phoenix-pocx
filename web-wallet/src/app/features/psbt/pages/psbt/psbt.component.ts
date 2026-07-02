import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
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
import { selectNetwork } from '../../../../store/settings/settings.selectors';
import { PsbtService } from '../../services/psbt.service';
import type { PsbtDocument, PsbtDraft, PsbtOutputView } from '../../psbt.models';
import { PsbtComposeComponent } from '../../components/psbt-compose/psbt-compose.component';
import { PsbtImportDialogComponent } from '../../components/psbt-import-dialog/psbt-import-dialog.component';
import { PsbtQrDialogComponent } from '../../components/psbt-qr-dialog/psbt-qr-dialog.component';

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

      <div class="content">
        <!-- ================= START ================= -->
        @if (view() === 'start') {
          <div class="start-column">
            <div class="card options-card">
              <div
                class="mode-option"
                (click)="view.set('compose')"
                (keydown.enter)="view.set('compose')"
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

            @if (drafts().length > 0) {
              <div class="card drafts-card">
                <div class="card-head">
                  <h3 class="section-title">{{ 'psbt_in_progress' | i18n }}</h3>
                  <span class="section-aside">{{ 'psbt_saved_locally' | i18n }}</span>
                </div>
                @for (draft of drafts(); track draft.id) {
                  <div class="draft-row" (click)="openDraft(draft)" (keydown.enter)="openDraft(draft)" tabindex="0" role="button">
                    <span class="badge" [class]="draft.status">
                      <mat-icon>{{ statusIcon(draft.status) }}</mat-icon>
                      {{ 'psbt_status_' + draft.status | i18n }}
                    </span>
                    <div class="draft-body">
                      <div class="draft-name">{{ draft.name }}</div>
                      <div class="draft-meta">
                        {{ draft.amountLabel }} · {{ draft.updatedAt | date: 'short' }}
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
              </div>
            }
          </div>
        }

        <!-- ================= COMPOSE ================= -->
        @if (view() === 'compose') {
          <app-psbt-compose (created)="onComposed($event)" (cancelled)="view.set('start')">
          </app-psbt-compose>
        }

        <!-- ================= DOCUMENT (review / broadcast) ================= -->
        @if (view() === 'doc' && doc(); as document) {
          <!-- Document header -->
          <div class="card">
            <div class="doc-head">
              <div class="doc-top">
                <div class="doc-id">
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
                    psbt · {{ document.sizeBytes }} bytes ·
                    {{ 'psbt_unsigned_txid' | i18n }} {{ shortId(document.unsignedTxid) }}
                  </div>
                </div>
                <span class="badge" [class]="document.status">
                  <mat-icon>{{ statusIcon(document.status) }}</mat-icon>
                  {{ statusLabel(document) }}
                </span>
              </div>

              <!-- Lifecycle track -->
              <div class="track mono">
                <span class="track-item done"><mat-icon>check</mat-icon>{{ 'psbt_track_composed' | i18n }}</span>
                <span class="track-sep">—</span>
                <span
                  class="track-item"
                  [class.done]="document.status === 'ready' || document.status === 'finalized'"
                  [class.now]="document.status === 'unsigned' || document.status === 'partial'"
                >
                  @if (document.status === 'ready' || document.status === 'finalized') {
                    <mat-icon>check</mat-icon>
                  } @else {
                    <mat-icon>draw</mat-icon>
                  }
                  {{ 'psbt_track_signing' | i18n }} {{ document.signedInputs }}/{{ document.inputs.length }}
                </span>
                <span class="track-sep">—</span>
                <span
                  class="track-item"
                  [class.done]="document.status === 'finalized'"
                  [class.now]="document.status === 'ready'"
                >
                  @if (document.status === 'finalized') {
                    <mat-icon>check</mat-icon>
                  }
                  {{ 'psbt_track_finalize' | i18n }}
                </span>
                <span class="track-sep">—</span>
                <span class="track-item" [class.now]="document.status === 'finalized'">
                  {{ 'psbt_track_broadcast' | i18n }}
                </span>
              </div>

              <!-- Guidance -->
              <div class="guide">
                <mat-icon>{{ document.status === 'finalized' ? 'task_alt' : 'info' }}</mat-icon>
                <div>{{ guidance(document) }}</div>
              </div>
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
                    {{ document.feeRate | number: '1.0-1' }}
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
              @for (input of document.inputs; track input.index) {
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
                    @if (input.isFinal || (input.sigCount > 0 && input.missingSigs === 0)) {
                      <mat-icon
                        class="ok"
                        [matTooltip]="(input.isFinal ? 'psbt_input_final' : 'psbt_input_signed') | i18n"
                        >check_circle</mat-icon
                      >
                    } @else if (input.sigCount > 0) {
                      <span
                        class="sig-count"
                        [matTooltip]="'psbt_input_partial' | i18n: { signed: input.sigCount, missing: input.missingSigs }"
                        >{{ input.sigCount }}<mat-icon>draw</mat-icon></span
                      >
                    } @else {
                      <mat-icon class="wait" [matTooltip]="'psbt_input_unsigned' | i18n">pending</mat-icon>
                    }
                  </span>
                </div>
              }
            </div>

            <div class="card io-card">
              <div class="card-head">
                <h3 class="section-title">{{ 'psbt_outputs' | i18n }}</h3>
                <span class="section-aside">{{ document.outputs.length }}</span>
              </div>
              @for (out of document.outputs; track out.index) {
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
            </div>
          </div>

          @if (document.status !== 'finalized') {
            <!-- Signatures & actions -->
            <div class="card">
              <div class="card-pad">
                <div class="card-head no-pad">
                  <h3 class="section-title">{{ 'psbt_signatures' | i18n }}</h3>
                </div>
                <div class="actions">
                  <button
                    mat-raised-button
                    color="primary"
                    [disabled]="signing() || document.status === 'ready'"
                    (click)="sign()"
                  >
                    @if (signing()) {
                      <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                    } @else {
                      <mat-icon>draw</mat-icon>
                    }
                    {{ 'psbt_sign_with_wallet' | i18n }}
                  </button>
                  <button mat-stroked-button [disabled]="combining()" (click)="combine()">
                    <mat-icon>call_merge</mat-icon>
                    {{ 'psbt_combine' | i18n }}
                  </button>
                  <button
                    mat-stroked-button
                    disabled
                    [matTooltip]="'psbt_coming_soon' | i18n"
                  >
                    <mat-icon>usb</mat-icon>
                    {{ 'psbt_sign_with_device' | i18n }}
                    <span class="soon-pill">{{ 'psbt_soon' | i18n }}</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Share / export -->
            <div class="card">
              <div class="card-pad">
                <div class="card-head no-pad">
                  <h3 class="section-title">{{ 'psbt_share' | i18n }}</h3>
                  <span class="section-aside mono">Base64 · {{ document.sizeBytes }} bytes</span>
                </div>
                <div class="raw-box mono">{{ document.base64 }}</div>
                <div class="actions">
                  <button mat-stroked-button (click)="copyBase64()">
                    <mat-icon>content_copy</mat-icon>
                    {{ 'psbt_copy_base64' | i18n }}
                  </button>
                  <button mat-stroked-button (click)="savePsbtFile()">
                    <mat-icon>download</mat-icon>
                    {{ 'psbt_save_file' | i18n }}
                  </button>
                  <button mat-stroked-button (click)="showQr()">
                    <mat-icon>qr_code_2</mat-icon>
                    {{ 'psbt_show_qr' | i18n }}
                  </button>
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
                <div class="target selected">
                  <span class="radio checked"></span>
                  <div class="target-body">
                    <div class="target-name">{{ 'psbt_target_local' | i18n }}</div>
                    <div class="target-hint">{{ 'psbt_target_local_hint' | i18n }}</div>
                  </div>
                  <mat-icon class="ok">check_circle</mat-icon>
                </div>
                <div class="target disabled">
                  <span class="radio"></span>
                  <div class="target-body">
                    <div class="target-name">
                      Electrum <span class="soon-pill">{{ 'psbt_soon' | i18n }}</span>
                    </div>
                    <div class="target-hint">{{ 'psbt_target_electrum_hint' | i18n }}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Final hex -->
            @if (finalHex(); as hex) {
              <div class="card">
                <div class="card-pad">
                  <div class="card-head no-pad">
                    <h3 class="section-title">{{ 'psbt_final_tx' | i18n }}</h3>
                    <span class="section-aside mono">hex · {{ hex.length / 2 }} bytes</span>
                  </div>
                  <div class="raw-box mono">{{ hex }}</div>
                  <div class="actions">
                    <button mat-stroked-button (click)="copyHex()">
                      <mat-icon>content_copy</mat-icon>
                      {{ 'psbt_copy_hex' | i18n }}
                    </button>
                    <button mat-stroked-button (click)="saveHexFile()">
                      <mat-icon>download</mat-icon>
                      {{ 'psbt_save_file' | i18n }}
                    </button>
                  </div>
                </div>
              </div>
            }
          }

          <!-- Error -->
          @if (docError()) {
            <div class="error-banner">
              <mat-icon>error</mat-icon>
              <span>{{ docError() }}</span>
            </div>
          }

          <!-- Bottom actions -->
          <div class="actions bottom-actions">
            <button mat-stroked-button (click)="discardDraft()">
              <mat-icon>delete_outline</mat-icon>
              {{ 'psbt_discard' | i18n }}
            </button>
            <span class="spacer"></span>
            @if (document.status !== 'finalized') {
              <button
                mat-stroked-button
                [disabled]="document.status !== 'ready' || finalizing()"
                [matTooltip]="document.status !== 'ready' ? ('psbt_finalize_needs_sigs' | i18n) : ''"
                (click)="finalize()"
              >
                @if (finalizing()) {
                  <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                } @else {
                  <mat-icon>lock</mat-icon>
                }
                {{ 'psbt_finalize' | i18n }}
              </button>
            }
            <button
              mat-raised-button
              class="broadcast-button"
              [disabled]="document.status !== 'finalized' || !finalHex() || broadcasting()"
              (click)="broadcast()"
            >
              @if (broadcasting()) {
                <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
              } @else {
                <mat-icon>send</mat-icon>
              }
              {{ 'psbt_broadcast' | i18n }}
            </button>
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
              <button mat-stroked-button routerLink="/transactions">
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

      .content {
        padding: 24px;
        max-width: 1100px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
        position: relative;
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
        max-width: 600px;
        margin: 0 auto;
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

      // ============ Document header ============
      .doc-head {
        padding: 18px 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .doc-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }

      .doc-id {
        h2 {
          font-size: 18px;
          color: rgb(0, 35, 65);
          font-weight: 600;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .rename-button {
          width: 28px;
          height: 28px;
          padding: 0;

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
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
          font-size: 11.5px;
          color: #6b7787;
          margin-top: 3px;
        }
      }

      // ============ Lifecycle track ============
      .track {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 11.5px;
        color: #9aa7b5;

        .track-item {
          display: inline-flex;
          align-items: center;
          gap: 5px;

          mat-icon {
            font-size: 14px;
            width: 14px;
            height: 14px;
          }

          &.done {
            color: #2e7d32;
          }

          &.now {
            color: #e65100;
            font-weight: 600;
          }
        }

        .track-sep {
          color: #e6ebf1;
        }
      }

      .guide {
        background: #f5f7fa;
        border-radius: 6px;
        padding: 10px 14px;
        font-size: 13px;
        color: rgb(0, 35, 65);
        display: flex;
        align-items: flex-start;
        gap: 10px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #1976d2;
          margin-top: 1px;
          flex-shrink: 0;
        }
      }

      // ============ Stats ============
      .stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1px;
        background: #e6ebf1;
        border-top: 1px solid #e6ebf1;
      }

      .stat {
        background: #fff;
        padding: 13px 20px;

        .stat-key {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: #6b7787;
          margin-bottom: 3px;
        }

        .stat-value {
          font-size: 16px;
          font-weight: 600;
          color: rgb(0, 35, 65);

          small {
            font-size: 11px;
            color: #6b7787;
            font-weight: 500;
            font-family: 'Montserrat', sans-serif;
          }
        }
      }

      // ============ I/O ============
      .io-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
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

      .bottom-actions {
        margin-top: 0;
        margin-bottom: 24px;
      }

      .broadcast-button {
        background: #4caf50 !important;
        color: white !important;

        &:disabled {
          background: rgba(0, 0, 0, 0.12) !important;
          color: rgba(0, 0, 0, 0.38) !important;
        }
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

      // ============ Raw box ============
      .raw-box {
        background: #0f2033;
        border-radius: 6px;
        padding: 12px 14px;
        font-size: 11.5px;
        color: #8fb8e0;
        word-break: break-all;
        max-height: 96px;
        overflow-y: auto;
        line-height: 1.5;
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
        .success-card {
          background: #424242;
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
        .guide,
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

        .guide {
          background: #333;
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

        .soon-pill {
          background: #333;
        }
      }

      // ============ Responsive ============
      @media (max-width: 900px) {
        .io-grid {
          grid-template-columns: 1fr;
        }

        .stats {
          grid-template-columns: repeat(2, 1fr);
        }
      }

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
  private readonly psbtService = inject(PsbtService);
  private readonly notification = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly i18n = inject(I18nService);
  private readonly location = inject(Location);
  private readonly store = inject(Store);
  readonly network = toSignal(this.store.select(selectNetwork), { initialValue: 'mainnet' });

  readonly view = signal<PsbtView>('start');
  readonly doc = signal<PsbtDocument | null>(null);
  readonly draft = signal<PsbtDraft | null>(null);
  readonly drafts = signal<PsbtDraft[]>([]);
  readonly finalHex = signal<string | null>(null);
  readonly broadcastTxid = signal('');

  readonly loadingDoc = signal(false);
  readonly signing = signal(false);
  readonly combining = signal(false);
  readonly finalizing = signal(false);
  readonly broadcasting = signal(false);
  readonly docError = signal<string | null>(null);

  readonly renaming = signal(false);
  renameValue = '';

  readonly draftName = computed(() => this.draft()?.name ?? this.i18n.get('psbt_untitled'));
  readonly feeWarning = computed(() => {
    const document = this.doc();
    return document ? this.psbtService.checkFee(document) : null;
  });

  ngOnInit(): void {
    this.refreshDrafts();
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
    await this.loadDocument(event.psbt, true);
  }

  async importPsbt(): Promise<void> {
    const dialogRef = this.dialog.open(PsbtImportDialogComponent, {
      width: '520px',
      data: { titleKey: 'psbt_door_import' },
    });
    const base64: string | undefined = await firstValueFrom(dialogRef.afterClosed());
    if (base64) {
      await this.loadDocument(base64, true);
    }
  }

  async openDraft(draft: PsbtDraft): Promise<void> {
    this.draft.set(draft);
    this.finalHex.set(draft.finalHex ?? null);
    await this.loadDocument(draft.psbt, false);
  }

  private async loadDocument(base64: string, createDraft: boolean): Promise<void> {
    this.loadingDoc.set(true);
    this.docError.set(null);
    try {
      const document = await this.psbtService.buildDocument(base64);
      this.doc.set(document);
      if (createDraft) {
        this.finalHex.set(null);
        const draft = this.psbtService.createDraft(this.network(), document.base64, document);
        this.draft.set(draft);
        this.psbtService.saveDraft(draft);
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
      if (!(await this.ensureWalletUnlocked(walletName))) return;
      const before = document.base64;
      // finalize=false keeps sealing an explicit, separate step
      const result = await this.walletRpc.walletProcessPsbt(
        walletName,
        document.base64,
        true,
        'ALL',
        true,
        false
      );
      if (result.psbt === before) {
        // Nothing changed: either everything signable is already signed,
        // or the missing keys live elsewhere
        const key =
          document.status === 'ready' || result.complete
            ? 'psbt_already_signed'
            : 'psbt_no_sigs_added';
        this.notification.info(this.i18n.get(key));
        return;
      }
      this.doc.set(await this.psbtService.buildDocument(result.psbt));
      this.syncDraft();
      this.notification.success(this.i18n.get('psbt_signed'));
    } catch (error) {
      this.docError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.signing.set(false);
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
      const combined = await this.walletRpc.combinePsbt([document.base64, other]);
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
      const txid = await this.blockchainRpc.sendRawTransaction(hex);
      this.broadcastTxid.set(txid);
      const draft = this.draft();
      if (draft) this.psbtService.deleteDraft(draft.id);
      this.view.set('success');
      this.walletService.refresh();
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

  savePsbtFile(): void {
    const document = this.doc();
    if (!document) return;
    this.psbtService.savePsbtFile(this.fileBaseName(), document.base64);
  }

  saveHexFile(): void {
    const hex = this.finalHex();
    if (!hex) return;
    this.psbtService.saveHexFile(this.fileBaseName(), hex);
  }

  showQr(): void {
    const document = this.doc();
    if (!document) return;
    this.dialog.open(PsbtQrDialogComponent, {
      data: { base64: document.base64 },
    });
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
      return this.i18n.get('psbt_status_partial_n', {
        signed: document.signedInputs,
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
