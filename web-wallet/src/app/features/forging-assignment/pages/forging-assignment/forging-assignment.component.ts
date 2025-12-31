import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Location } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { takeUntil, skip } from 'rxjs/operators';
import { I18nPipe, I18nService } from '../../../../core/i18n';
import { NotificationService } from '../../../../shared/services';
import { WalletManagerService } from '../../../../bitcoin/services/wallet/wallet-manager.service';
import { WalletRpcService } from '../../../../bitcoin/services/rpc/wallet-rpc.service';
import { BlockchainRpcService } from '../../../../bitcoin/services/rpc/blockchain-rpc.service';
import { BlockchainStateService } from '../../../../bitcoin/services/blockchain-state.service';
import {
  MiningRpcService,
  AssignmentStatus,
  AssignmentState,
} from '../../../../bitcoin/services/rpc/mining-rpc.service';

type OperationMode = 'create' | 'revoke' | 'check';

interface FeeOption {
  label: string;
  blocks: number;
  feeRate: number | null;
  timeEstimate: string;
}

interface WalletAddress {
  address: string;
  label: string;
  isSegwitV0: boolean;
}

/**
 * ForgingAssignmentComponent manages forging assignments for Bitcoin-PoCX.
 *
 * Features:
 * - Create new forging assignments (delegate forging rights)
 * - Revoke existing assignments
 * - Check assignment status
 * - Shows progress for pending assignments/revocations
 */
@Component({
  selector: 'app-forging-assignment',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatAutocompleteModule,
    MatTooltipModule,
    MatDialogModule,
    I18nPipe,
    DecimalPipe,
  ],
  template: `
    <div class="page-layout">
      <!-- Header -->
      <div class="header">
        <div class="header-left">
          <button mat-icon-button class="back-button" (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>{{ 'forging_assignment' | i18n }}</h1>
        </div>
        <div class="header-right">
          <div class="block-height">
            <span class="block-label">{{ 'block_height' | i18n }}:</span>
            <span class="block-value">{{ currentBlockHeight() | number }}</span>
          </div>
        </div>
      </div>

      <div class="content">
        <div class="assignment-card">
          <!-- Tab Navigation -->
          <mat-tab-group
            [(selectedIndex)]="selectedTabIndex"
            (selectedIndexChange)="onTabChange($event)"
            class="assignment-tabs"
          >
            <!-- Create Assignment Tab -->
            <mat-tab>
              <ng-template mat-tab-label>
                <mat-icon class="tab-icon">add_circle_outline</mat-icon>
                <span class="tab-label">{{ 'create_assignment' | i18n }}</span>
              </ng-template>

              <div class="tab-content">
                <!-- Description -->
                <div class="description-box">
                  <mat-icon class="description-icon">info_outline</mat-icon>
                  <div class="description-text">{{ 'create_assignment_description' | i18n }}</div>
                </div>

                <!-- Plot Address -->
                <div class="field-group">
                  <label class="field-label">{{ 'plot_address' | i18n }}</label>
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>{{ 'select_or_enter_plot_address' | i18n }}</mat-label>
                    <input
                      matInput
                      [matAutocomplete]="createPlotAuto"
                      [(ngModel)]="selectedPlotAddress"
                      (ngModelChange)="onPlotAddressChange($event)"
                      placeholder="tb1q... / bc1q..."
                    />
                    <mat-autocomplete #createPlotAuto="matAutocomplete">
                      @for (addr of walletAddresses(); track addr.address) {
                        <mat-option [value]="addr.address">
                          <span class="address-option">
                            <span class="address-text">{{ addr.address }}</span>
                            @if (addr.label) {
                              <span class="address-label">({{ addr.label }})</span>
                            }
                          </span>
                        </mat-option>
                      }
                    </mat-autocomplete>
                    @if (plotAddressError()) {
                      <mat-hint class="error-hint">{{ plotAddressError() }}</mat-hint>
                    }
                  </mat-form-field>
                </div>

                <!-- Forging Address -->
                <div class="field-group">
                  <label class="field-label">{{ 'forging_address' | i18n }}</label>
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>{{ 'enter_forging_address' | i18n }}</mat-label>
                    <input
                      matInput
                      [(ngModel)]="forgingAddress"
                      (ngModelChange)="onForgingAddressChange()"
                      placeholder="tb1q... / bc1q..."
                    />
                    @if (forgingAddressError()) {
                      <mat-hint class="error-hint">{{ forgingAddressError() }}</mat-hint>
                    }
                  </mat-form-field>
                </div>

                <!-- Fee Section -->
                <div class="fee-section">
                  <div class="section-header">
                    <label class="field-label">{{ 'fee' | i18n }}</label>
                    <button
                      type="button"
                      class="refresh-button"
                      (click)="refreshFeeEstimates()"
                      [disabled]="isLoadingFees()"
                      [title]="'refresh_fees' | i18n"
                    >
                      <mat-icon [class.spinning]="isLoadingFees()">refresh</mat-icon>
                    </button>
                  </div>

                  <div class="fee-options">
                    @for (option of feeOptions; track option.label) {
                      <button
                        mat-stroked-button
                        [class.selected]="selectedFeeOption === option"
                        (click)="selectFeeOption(option)"
                        [disabled]="option.feeRate === null && option.label !== 'fee_custom'"
                      >
                        <div class="fee-option">
                          <span class="fee-label">{{ option.label | i18n }}</span>
                          @if (option.label === 'fee_custom') {
                            <mat-icon class="custom-icon">tune</mat-icon>
                          } @else if (option.feeRate !== null) {
                            <span class="fee-rate">{{ option.feeRate }} sat/vB</span>
                            <span class="fee-time">{{ option.timeEstimate }}</span>
                          } @else {
                            <span class="fee-rate">--</span>
                          }
                        </div>
                      </button>
                    }
                  </div>

                  @if (selectedFeeOption?.label === 'fee_custom') {
                    <div class="custom-fee-input">
                      <mat-form-field appearance="outline">
                        <mat-label>{{ 'fee_rate' | i18n }} (sat/vB)</mat-label>
                        <input
                          matInput
                          type="number"
                          [(ngModel)]="customFeeRate"
                          (ngModelChange)="onCustomFeeChange()"
                          min="1"
                          step="1"
                          autocomplete="off"
                        />
                      </mat-form-field>
                    </div>
                  }
                </div>

                <!-- Action Buttons -->
                <div class="action-buttons">
                  <button mat-stroked-button (click)="clear()">{{ 'clear' | i18n }}</button>
                  <button
                    mat-raised-button
                    color="primary"
                    (click)="onSubmit()"
                    [disabled]="!canSubmit()"
                  >
                    @if (isSubmitting()) {
                      <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                    } @else {
                      <mat-icon>add_circle</mat-icon>
                    }
                    <span>{{ 'create_assignment' | i18n }}</span>
                  </button>
                </div>
              </div>
            </mat-tab>

            <!-- Revoke Assignment Tab -->
            <mat-tab>
              <ng-template mat-tab-label>
                <mat-icon class="tab-icon">remove_circle_outline</mat-icon>
                <span class="tab-label">{{ 'revoke_assignment' | i18n }}</span>
              </ng-template>

              <div class="tab-content">
                <!-- Description -->
                <div class="description-box">
                  <mat-icon class="description-icon">info_outline</mat-icon>
                  <div class="description-text">{{ 'revoke_assignment_description' | i18n }}</div>
                </div>

                <!-- Plot Address -->
                <div class="field-group">
                  <label class="field-label">{{ 'plot_address' | i18n }}</label>
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>{{ 'select_or_enter_plot_address' | i18n }}</mat-label>
                    <input
                      matInput
                      [matAutocomplete]="revokePlotAuto"
                      [(ngModel)]="selectedPlotAddress"
                      (ngModelChange)="onPlotAddressChange($event)"
                      placeholder="tb1q... / bc1q..."
                    />
                    <mat-autocomplete #revokePlotAuto="matAutocomplete">
                      @for (addr of walletAddresses(); track addr.address) {
                        <mat-option [value]="addr.address">
                          <span class="address-option">
                            <span class="address-text">{{ addr.address }}</span>
                            @if (addr.label) {
                              <span class="address-label">({{ addr.label }})</span>
                            }
                          </span>
                        </mat-option>
                      }
                    </mat-autocomplete>
                    @if (plotAddressError()) {
                      <mat-hint class="error-hint">{{ plotAddressError() }}</mat-hint>
                    }
                  </mat-form-field>
                </div>

                <!-- Fee Section -->
                <div class="fee-section">
                  <div class="section-header">
                    <label class="field-label">{{ 'fee' | i18n }}</label>
                    <button
                      type="button"
                      class="refresh-button"
                      (click)="refreshFeeEstimates()"
                      [disabled]="isLoadingFees()"
                      [title]="'refresh_fees' | i18n"
                    >
                      <mat-icon [class.spinning]="isLoadingFees()">refresh</mat-icon>
                    </button>
                  </div>

                  <div class="fee-options">
                    @for (option of feeOptions; track option.label) {
                      <button
                        mat-stroked-button
                        [class.selected]="selectedFeeOption === option"
                        (click)="selectFeeOption(option)"
                        [disabled]="option.feeRate === null && option.label !== 'fee_custom'"
                      >
                        <div class="fee-option">
                          <span class="fee-label">{{ option.label | i18n }}</span>
                          @if (option.label === 'fee_custom') {
                            <mat-icon class="custom-icon">tune</mat-icon>
                          } @else if (option.feeRate !== null) {
                            <span class="fee-rate">{{ option.feeRate }} sat/vB</span>
                            <span class="fee-time">{{ option.timeEstimate }}</span>
                          } @else {
                            <span class="fee-rate">--</span>
                          }
                        </div>
                      </button>
                    }
                  </div>

                  @if (selectedFeeOption?.label === 'fee_custom') {
                    <div class="custom-fee-input">
                      <mat-form-field appearance="outline">
                        <mat-label>{{ 'fee_rate' | i18n }} (sat/vB)</mat-label>
                        <input
                          matInput
                          type="number"
                          [(ngModel)]="customFeeRate"
                          (ngModelChange)="onCustomFeeChange()"
                          min="1"
                          step="1"
                          autocomplete="off"
                        />
                      </mat-form-field>
                    </div>
                  }
                </div>

                <!-- Action Buttons -->
                <div class="action-buttons">
                  <button mat-stroked-button (click)="clear()">{{ 'clear' | i18n }}</button>
                  <button
                    mat-raised-button
                    color="warn"
                    (click)="onSubmit()"
                    [disabled]="!canSubmit()"
                  >
                    @if (isSubmitting()) {
                      <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                    } @else {
                      <mat-icon>remove_circle</mat-icon>
                    }
                    <span>{{ 'revoke_assignment' | i18n }}</span>
                  </button>
                </div>
              </div>
            </mat-tab>

            <!-- Check Status Tab -->
            <mat-tab>
              <ng-template mat-tab-label>
                <mat-icon class="tab-icon">search</mat-icon>
                <span class="tab-label">{{ 'check_status' | i18n }}</span>
              </ng-template>

              <div class="tab-content">
                <!-- Description -->
                <div class="description-box">
                  <mat-icon class="description-icon">info_outline</mat-icon>
                  <div class="description-text">{{ 'check_status_description' | i18n }}</div>
                </div>

                <!-- Plot Address -->
                <div class="field-group">
                  <label class="field-label">{{ 'plot_address' | i18n }}</label>
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>{{ 'select_or_enter_plot_address' | i18n }}</mat-label>
                    <input
                      matInput
                      [matAutocomplete]="checkPlotAuto"
                      [(ngModel)]="selectedPlotAddress"
                      (ngModelChange)="onPlotAddressChange($event)"
                      placeholder="tb1q... / bc1q..."
                    />
                    <mat-autocomplete #checkPlotAuto="matAutocomplete">
                      @for (addr of walletAddresses(); track addr.address) {
                        <mat-option [value]="addr.address">
                          <span class="address-option">
                            <span class="address-text">{{ addr.address }}</span>
                            @if (addr.label) {
                              <span class="address-label">({{ addr.label }})</span>
                            }
                          </span>
                        </mat-option>
                      }
                    </mat-autocomplete>
                    @if (plotAddressError()) {
                      <mat-hint class="error-hint">{{ plotAddressError() }}</mat-hint>
                    }
                  </mat-form-field>
                </div>

                <!-- Status Display -->
                <div class="status-section">
                  <div class="status-header">
                    <h3>{{ 'assignment_status' | i18n }}</h3>
                    <button
                      mat-icon-button
                      (click)="checkStatus()"
                      [disabled]="!isPlotAddressValid() || isCheckingStatus()"
                      [matTooltip]="'refresh' | i18n"
                    >
                      <mat-icon [class.spinning]="isCheckingStatus()">refresh</mat-icon>
                    </button>
                  </div>

                  <!-- Status Content -->
                  @if (assignmentStatus()) {
                    <div class="status-content">
                      <!-- State Badge -->
                      <div
                        class="state-badge"
                        [ngClass]="getStateBadgeClass(assignmentStatus()!.state)"
                      >
                        {{ assignmentStatus()!.state }}
                      </div>

                      <!-- Status Details -->
                      <div class="status-details">
                        <!-- UNASSIGNED -->
                        @if (assignmentStatus()!.state === 'UNASSIGNED') {
                          <p class="status-message">{{ 'no_assignment_exists' | i18n }}</p>
                          <p class="status-hint">{{ 'can_create_assignment' | i18n }}</p>
                        }

                        <!-- ASSIGNING -->
                        @if (assignmentStatus()!.state === 'ASSIGNING') {
                          <div class="detail-row">
                            <span class="detail-label">{{ 'forging_address' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.forging_address
                            }}</span>
                          </div>
                          <div class="detail-row">
                            <span class="detail-label">{{ 'created_at_block' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.assignment_height | number
                            }}</span>
                          </div>
                          <div class="detail-row">
                            <span class="detail-label">{{ 'activates_at_block' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.activation_height | number
                            }}</span>
                          </div>
                          <div class="progress-section">
                            <mat-progress-bar
                              mode="determinate"
                              [value]="getProgressPercentage()"
                            ></mat-progress-bar>
                            <div class="progress-info">
                              <span
                                >{{ getBlocksRemaining() }} {{ 'blocks_remaining' | i18n }}</span
                              >
                              <span>{{ getEstimatedTime() }}</span>
                            </div>
                          </div>
                        }

                        <!-- ASSIGNED -->
                        @if (assignmentStatus()!.state === 'ASSIGNED') {
                          <div class="detail-row">
                            <span class="detail-label">{{ 'forging_address' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.forging_address
                            }}</span>
                          </div>
                          <div class="detail-row">
                            <span class="detail-label">{{ 'created_at_block' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.assignment_height | number
                            }}</span>
                          </div>
                          <div class="detail-row">
                            <span class="detail-label">{{ 'activated_at_block' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.activation_height | number
                            }}</span>
                          </div>
                          <p class="status-message success">{{ 'assignment_active' | i18n }}</p>
                        }

                        <!-- REVOKING -->
                        @if (assignmentStatus()!.state === 'REVOKING') {
                          <div class="detail-row">
                            <span class="detail-label">{{ 'forging_address' | i18n }}:</span>
                            <span class="detail-value"
                              >{{ assignmentStatus()!.forging_address }} ({{
                                'still_active' | i18n
                              }})</span
                            >
                          </div>
                          <div class="detail-row">
                            <span class="detail-label">{{ 'revoked_at_block' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.revocation_height | number
                            }}</span>
                          </div>
                          <div class="detail-row">
                            <span class="detail-label">{{ 'effective_at_block' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.revocation_effective_height | number
                            }}</span>
                          </div>
                          <div class="progress-section">
                            <mat-progress-bar
                              mode="determinate"
                              [value]="getProgressPercentage()"
                              color="warn"
                            ></mat-progress-bar>
                            <div class="progress-info">
                              <span
                                >{{ getBlocksRemaining() }} {{ 'blocks_remaining' | i18n }}</span
                              >
                              <span>{{ getEstimatedTime() }}</span>
                            </div>
                          </div>
                        }

                        <!-- REVOKED -->
                        @if (assignmentStatus()!.state === 'REVOKED') {
                          <div class="detail-row">
                            <span class="detail-label">{{ 'previously_assigned_to' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.forging_address
                            }}</span>
                          </div>
                          <div class="detail-row">
                            <span class="detail-label">{{ 'revocation_effective' | i18n }}:</span>
                            <span class="detail-value">{{
                              assignmentStatus()!.revocation_effective_height | number
                            }}</span>
                          </div>
                          <p class="status-message">{{ 'assignment_revoked' | i18n }}</p>
                          <p class="status-hint">{{ 'can_create_new_assignment' | i18n }}</p>
                        }
                      </div>
                    </div>
                  }

                  <!-- No Status Yet -->
                  @if (!assignmentStatus() && !isCheckingStatus()) {
                    <div class="no-status">
                      <mat-icon>help_outline</mat-icon>
                      <span>{{ 'no_status_checked' | i18n }}</span>
                    </div>
                  }

                  <!-- Loading -->
                  @if (isCheckingStatus()) {
                    <div class="loading-status">
                      <mat-spinner diameter="24"></mat-spinner>
                      <span>{{ 'checking_status' | i18n }}</span>
                    </div>
                  }
                </div>

                <!-- Action Buttons -->
                <div class="action-buttons">
                  <button mat-stroked-button (click)="clear()">{{ 'clear' | i18n }}</button>
                  <button
                    mat-raised-button
                    color="primary"
                    (click)="checkStatus()"
                    [disabled]="!isPlotAddressValid() || isCheckingStatus()"
                  >
                    @if (isCheckingStatus()) {
                      <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                    } @else {
                      <mat-icon>search</mat-icon>
                    }
                    <span>{{ 'check_status' | i18n }}</span>
                  </button>
                </div>
              </div>
            </mat-tab>
          </mat-tab-group>
        </div>
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

      // Header
      .header {
        background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
        color: white;
        padding: 16px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;

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

        .header-right {
          .block-height {
            background: rgba(255, 255, 255, 0.1);
            padding: 8px 16px;
            border-radius: 20px;

            .block-label {
              color: rgba(255, 255, 255, 0.7);
              margin-right: 8px;
            }

            .block-value {
              color: #fff;
              font-weight: 500;
            }
          }
        }
      }

      // Content
      .content {
        padding: 24px;
        display: flex;
        justify-content: center;
      }

      .assignment-card {
        width: 100%;
        max-width: 600px;
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        padding: 24px;
        overflow: hidden;
        box-sizing: border-box;
      }

      // Tab Navigation
      .assignment-tabs {
        // MDC Tab styling for Material 19
        ::ng-deep {
          .mat-mdc-tab-header {
            border-bottom: 1px solid #e0e0e0;
          }

          .mat-mdc-tab {
            min-width: 120px;
            padding: 0 12px;
            flex-grow: 1;
          }

          .mdc-tab__text-label {
            font-size: 13px;
          }
        }

        .tab-icon {
          margin-right: 6px;
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        .tab-label {
          font-weight: 500;
          font-size: 13px;
        }

        .tab-content {
          padding: 24px 0;
        }
      }

      // Field Groups
      .field-group {
        margin-bottom: 20px;

        .field-label {
          display: block;
          font-size: 14px;
          font-weight: 600;
          color: rgb(0, 35, 65);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
      }

      .full-width {
        width: 100%;
      }

      .address-option {
        display: flex;
        align-items: center;
        gap: 8px;

        .address-text {
          font-family: monospace;
        }

        .address-label {
          color: #666;
          font-size: 12px;
        }
      }

      // Description Box
      .description-box {
        display: flex;
        align-items: flex-start;
        padding: 12px 16px;
        border-radius: 6px;
        margin-bottom: 24px;
        background: #f8f9fa;
        border: 1px solid #e0e0e0;

        .description-icon {
          margin-right: 12px;
          flex-shrink: 0;
          color: #666;
          font-size: 20px;
          width: 20px;
          height: 20px;
        }

        .description-text {
          font-size: 13px;
          line-height: 1.5;
          color: #555;
        }
      }

      // Status Section
      .status-section {
        background: #ffffff;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 24px;
        border: 1px solid #e0e0e0;

        .status-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;

          h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: rgb(0, 35, 65);
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          mat-icon.spinning {
            animation: spin 1s linear infinite;
          }
        }

        .status-content {
          padding: 16px;
          background: #fff;
          border-radius: 8px;
        }

        .no-status,
        .loading-status {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          color: #999;
          gap: 12px;

          mat-icon {
            font-size: 32px;
            width: 32px;
            height: 32px;
          }
        }
      }

      // State Badges
      .state-badge {
        display: inline-block;
        padding: 6px 16px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 16px;

        &.badge-unassigned {
          background: #e0e0e0;
          color: #666;
        }

        &.badge-assigning {
          background: #fff3e0;
          color: #e65100;
        }

        &.badge-assigned {
          background: #e8f5e9;
          color: #2e7d32;
        }

        &.badge-revoking {
          background: #fbe9e7;
          color: #d84315;
        }

        &.badge-revoked {
          background: #ffebee;
          color: #c62828;
        }
      }

      // Status Details
      .status-details {
        .detail-row {
          display: flex;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid #f0f0f0;

          &:last-child {
            border-bottom: none;
          }

          .detail-label {
            flex: 0 0 180px;
            color: #666;
            font-size: 14px;
          }

          .detail-value {
            font-family: monospace;
            font-size: 14px;
            color: #333;
          }
        }

        .status-message {
          margin: 16px 0 8px;
          font-size: 14px;
          color: #666;

          &.success {
            color: #2e7d32;
            font-weight: 500;
          }
        }

        .status-hint {
          margin: 0;
          font-size: 13px;
          color: #999;
          font-style: italic;
        }
      }

      // Progress Section
      .progress-section {
        margin-top: 16px;
        padding: 16px;
        background: #ffffff;
        border-radius: 8px;

        mat-progress-bar {
          height: 8px;
          border-radius: 4px;
        }

        .progress-info {
          display: flex;
          justify-content: space-between;
          margin-top: 8px;
          font-size: 13px;
          color: #666;
        }
      }

      // Fee Section
      .fee-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #e0e0e0;
        overflow: hidden;

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 8px;

          .field-label {
            margin-bottom: 0;
          }

          .refresh-button {
            width: 24px;
            height: 24px;
            min-width: 24px;
            max-width: 24px;
            padding: 0;
            border: none;
            background: transparent;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            flex-shrink: 0;

            mat-icon {
              font-size: 16px;
              width: 16px;
              height: 16px;
              line-height: 16px;
              color: #666;
              margin: 0;

              &.spinning {
                animation: spin 1s linear infinite;
              }
            }

            &:hover {
              background: rgba(0, 0, 0, 0.04);

              mat-icon {
                color: #1976d2;
              }
            }

            &:disabled {
              cursor: default;
              opacity: 0.5;

              &:hover {
                background: transparent;
              }
            }
          }
        }

        .fee-options {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 8px;
          width: 100%;

          button {
            flex: 1 1 calc(25% - 4px);
            min-width: 0;
            height: auto;
            padding: 4px 2px;
            border-color: #e0e0e0;

            &.selected {
              border-color: #1976d2;
              background: rgba(25, 118, 210, 0.08);
            }

            .fee-option {
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 1px;

              .fee-label {
                font-weight: 600;
                font-size: 11px;
                color: rgb(0, 35, 65);
              }

              .fee-rate {
                font-size: 12px;
                font-weight: 500;
                color: #1976d2;
                font-family: monospace;
              }

              .fee-time {
                font-size: 10px;
                color: #888;
              }

              .custom-icon {
                font-size: 18px;
                height: 18px;
                width: 18px;
                color: #666;
              }
            }
          }
        }

        .custom-fee-input {
          margin-bottom: 4px;

          mat-form-field {
            max-width: 180px;
          }
        }
      }

      // Action Buttons
      .action-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        padding-top: 24px;
        margin-top: 24px;
        border-top: 1px solid #e0e0e0;

        button {
          min-width: 160px;

          mat-icon {
            margin-right: 8px;
          }

          .button-spinner {
            display: inline-block;
            margin-right: 8px;
          }
        }
      }

      // Error hints
      .error-hint {
        color: #f44336;
      }

      // Animations
      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      // Dark theme
      :host-context(.dark-theme) {
        .assignment-card {
          background: #424242;
        }

        .field-label,
        .status-header h3 {
          color: #ffffff;
        }

        .description-box {
          background: #333;
          border-color: #555;
        }

        .status-section {
          background: #333;
          border-color: #555;

          .status-content {
            background: #424242;
          }
        }

        .detail-row {
          border-bottom-color: #555 !important;

          .detail-value {
            color: #ffffff;
          }
        }

        .progress-section {
          background: #333;
        }
      }

      // Responsive
      @media (max-width: 600px) {
        .status-details .detail-row {
          flex-direction: column;
          align-items: flex-start;

          .detail-label {
            flex: none;
            margin-bottom: 4px;
          }
        }

        .action-buttons {
          flex-direction: column;

          button {
            width: 100%;
          }
        }
      }
    `,
  ],
})
export class ForgingAssignmentComponent implements OnInit, OnDestroy {
  private readonly location = inject(Location);
  private readonly notification = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly walletManager = inject(WalletManagerService);
  private readonly walletRpc = inject(WalletRpcService);
  private readonly blockchainRpc = inject(BlockchainRpcService);
  private readonly blockchainState = inject(BlockchainStateService);
  private readonly miningRpc = inject(MiningRpcService);
  private readonly destroy$ = new Subject<void>();

  // Tab selection
  selectedTabIndex = 0;
  currentMode: OperationMode = 'create';

  // Form fields
  selectedPlotAddress = '';
  forgingAddress = '';
  walletAddresses = signal<WalletAddress[]>([]);

  // Status display
  assignmentStatus = signal<AssignmentStatus | null>(null);
  isCheckingStatus = signal(false);
  // Block height from centralized BlockchainStateService - auto-updates via polling
  currentBlockHeight = computed(() => this.blockchainState.blockHeight());

  // Transaction state
  isSubmitting = signal(false);

  // Fee estimation
  isLoadingFees = signal(false);
  customFeeRate: number | null = null;
  feeOptions: FeeOption[] = [
    { label: 'fee_slow', blocks: 144, feeRate: null, timeEstimate: '~60 min' },
    { label: 'fee_normal', blocks: 6, feeRate: null, timeEstimate: '~30 min' },
    { label: 'fee_fast', blocks: 1, feeRate: null, timeEstimate: '~10 min' },
    { label: 'fee_custom', blocks: 6, feeRate: null, timeEstimate: '' },
  ];
  selectedFeeOption: FeeOption | null = null;

  // Validation
  isPlotAddressValid = signal(false);
  isForgingAddressValid = signal(false);
  plotAddressError = signal<string | null>(null);
  forgingAddressError = signal<string | null>(null);

  ngOnInit(): void {
    this.loadWalletAddresses();
    this.loadFeeEstimates();
    // Note: Block height is now handled by BlockchainStateService with auto-refresh

    // Subscribe to wallet changes to reload addresses
    this.walletManager.activeWallet$
      .pipe(
        skip(1), // Skip initial value since we already loaded
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.clearStatus();
        this.selectedPlotAddress = '';
        this.forgingAddress = '';
        this.loadWalletAddresses();
        this.loadFeeEstimates();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.location.back();
  }

  onTabChange(index: number): void {
    const modes: OperationMode[] = ['create', 'revoke', 'check'];
    this.currentMode = modes[index];
    this.clearStatus();
    this.validateInputs();
  }

  private async loadWalletAddresses(): Promise<void> {
    const walletName = this.walletManager.activeWallet;
    if (!walletName) return;

    try {
      // Get all addresses with empty label (receiving addresses)
      const addressMap = await this.walletRpc.getAddressesByLabel(walletName, '');
      const addresses: WalletAddress[] = [];

      for (const address of Object.keys(addressMap)) {
        // Check if it's a SegWit v0 address (bech32 starting with bc1q/tb1q or pocx1q/tpocx1q)
        const isSegwitV0 = /^(bc1q|tb1q|pocx1q|tpocx1q)[a-z0-9]{38,}$/i.test(address);
        if (isSegwitV0) {
          const addrInfo = await this.walletRpc.getAddressInfo(walletName, address);
          addresses.push({
            address,
            label: addrInfo.labels?.[0] || '',
            isSegwitV0: true,
          });
        }
      }

      this.walletAddresses.set(addresses);
    } catch (error) {
      console.error('Failed to load wallet addresses:', error);
    }
  }

  onPlotAddressChange(address: string): void {
    this.selectedPlotAddress = address;
    this.validatePlotAddress();
    this.clearStatus();
  }

  onForgingAddressChange(): void {
    this.validateForgingAddress();
  }

  private validatePlotAddress(): void {
    const address = this.selectedPlotAddress.trim();

    if (!address) {
      this.isPlotAddressValid.set(false);
      this.plotAddressError.set(null);
      return;
    }

    // Check if it's a SegWit v0 address
    const isSegwitV0 = /^(bc1q|tb1q|pocx1q|tpocx1q)[a-z0-9]{38,}$/i.test(address);
    if (!isSegwitV0) {
      this.isPlotAddressValid.set(false);
      this.plotAddressError.set(this.i18n.get('address_must_be_segwit_v0'));
      return;
    }

    this.isPlotAddressValid.set(true);
    this.plotAddressError.set(null);
  }

  private validateForgingAddress(): void {
    const address = this.forgingAddress.trim();

    if (!address) {
      this.isForgingAddressValid.set(false);
      this.forgingAddressError.set(null);
      return;
    }

    // Check if it's a SegWit v0 address
    const isSegwitV0 = /^(bc1q|tb1q|pocx1q|tpocx1q)[a-z0-9]{38,}$/i.test(address);
    if (!isSegwitV0) {
      this.isForgingAddressValid.set(false);
      this.forgingAddressError.set(this.i18n.get('address_must_be_segwit_v0'));
      return;
    }

    // Check it's different from plot address
    if (address.toLowerCase() === this.selectedPlotAddress.toLowerCase()) {
      this.isForgingAddressValid.set(false);
      this.forgingAddressError.set(this.i18n.get('forging_address_must_differ'));
      return;
    }

    this.isForgingAddressValid.set(true);
    this.forgingAddressError.set(null);
  }

  private validateInputs(): void {
    this.validatePlotAddress();
    if (this.currentMode === 'create') {
      this.validateForgingAddress();
    }
  }

  canSubmit(): boolean {
    if (this.isSubmitting()) return false;

    switch (this.currentMode) {
      case 'create':
        return this.isPlotAddressValid() && this.isForgingAddressValid();
      case 'revoke':
        return this.isPlotAddressValid();
      case 'check':
        return this.isPlotAddressValid();
      default:
        return false;
    }
  }

  // Fee estimation methods
  async loadFeeEstimates(): Promise<void> {
    this.isLoadingFees.set(true);
    try {
      for (const option of this.feeOptions) {
        if (option.label === 'fee_custom') continue;
        const result = await this.blockchainRpc.estimateSmartFee(option.blocks);
        if (result.feerate) {
          // feerate is in BTC/kvB, convert to sat/vB
          option.feeRate = Math.round((result.feerate * 100000000) / 1000);
        }
      }
      // Default to normal fee
      this.selectedFeeOption = this.feeOptions[1];
    } catch (error) {
      console.error('Failed to load fee estimates:', error);
    } finally {
      this.isLoadingFees.set(false);
    }
  }

  refreshFeeEstimates(): void {
    this.loadFeeEstimates();
  }

  selectFeeOption(option: FeeOption): void {
    this.selectedFeeOption = option;
    if (option.label === 'fee_custom' && this.customFeeRate) {
      option.feeRate = this.customFeeRate;
    }
  }

  onCustomFeeChange(): void {
    if (this.selectedFeeOption?.label === 'fee_custom' && this.customFeeRate) {
      this.selectedFeeOption.feeRate = this.customFeeRate;
    }
  }

  getSelectedFeeRate(): number | undefined {
    if (this.selectedFeeOption?.label === 'fee_custom') {
      return this.customFeeRate ?? undefined;
    }
    return this.selectedFeeOption?.feeRate ?? undefined;
  }

  async checkStatus(): Promise<void> {
    if (!this.isPlotAddressValid()) return;

    this.isCheckingStatus.set(true);
    this.assignmentStatus.set(null);

    try {
      // Block height is auto-refreshed by BlockchainStateService
      const status = await this.miningRpc.getAssignmentStatus(this.selectedPlotAddress);
      this.assignmentStatus.set(status);
    } catch (error) {
      console.error('Failed to check assignment status:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.notification.error(`${this.i18n.get('error_checking_status')}: ${errorMsg}`);
    } finally {
      this.isCheckingStatus.set(false);
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;

    const walletName = this.walletManager.activeWallet;
    if (!walletName) {
      this.notification.error(this.i18n.get('no_wallet_selected'));
      return;
    }

    // Pre-flight check: verify current state allows the operation
    try {
      const status = await this.miningRpc.getAssignmentStatus(this.selectedPlotAddress);

      if (this.currentMode === 'create') {
        if (status.state !== 'UNASSIGNED' && status.state !== 'REVOKED') {
          this.notification.error(
            this.i18n.get('cannot_create_assignment_state').replace('{state}', status.state)
          );
          return;
        }
      } else if (this.currentMode === 'revoke') {
        if (status.state !== 'ASSIGNED') {
          this.notification.error(
            this.i18n.get('cannot_revoke_assignment_state').replace('{state}', status.state)
          );
          return;
        }
      }
    } catch {
      // If get_assignment fails, the plot might be unassigned (no record)
      // For create, this is OK. For revoke, this is an error.
      if (this.currentMode === 'revoke') {
        this.notification.error(this.i18n.get('no_assignment_to_revoke'));
        return;
      }
    }

    this.isSubmitting.set(true);

    try {
      const feeRate = this.getSelectedFeeRate();

      if (this.currentMode === 'create') {
        const result = await this.miningRpc.createForgingAssignment(
          walletName,
          this.selectedPlotAddress,
          this.forgingAddress.trim(),
          feeRate
        );
        this.notification.success(
          `${this.i18n.get('assignment_created_success')} (${result.txid.substring(0, 16)}...)`
        );
        this.clear();
      } else if (this.currentMode === 'revoke') {
        const result = await this.miningRpc.revokeForgingAssignment(
          walletName,
          this.selectedPlotAddress,
          feeRate
        );
        this.notification.success(
          `${this.i18n.get('revocation_created_success')} (${result.txid.substring(0, 16)}...)`
        );
        this.clear();
      }
    } catch (error) {
      console.error('Transaction failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.notification.error(`${this.i18n.get('transaction_failed')}: ${errorMsg}`);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  clear(): void {
    this.selectedPlotAddress = '';
    this.forgingAddress = '';
    this.assignmentStatus.set(null);
    this.isPlotAddressValid.set(false);
    this.isForgingAddressValid.set(false);
    this.plotAddressError.set(null);
    this.forgingAddressError.set(null);
  }

  clearStatus(): void {
    this.assignmentStatus.set(null);
  }

  // Helper methods for template
  getStateBadgeClass(state: AssignmentState): string {
    switch (state) {
      case 'UNASSIGNED':
        return 'badge-unassigned';
      case 'ASSIGNING':
        return 'badge-assigning';
      case 'ASSIGNED':
        return 'badge-assigned';
      case 'REVOKING':
        return 'badge-revoking';
      case 'REVOKED':
        return 'badge-revoked';
      default:
        return 'badge-unassigned';
    }
  }

  getBlocksRemaining(): number {
    const status = this.assignmentStatus();
    if (!status) return 0;

    if (status.state === 'ASSIGNING' && status.activation_height) {
      return Math.max(0, status.activation_height - this.currentBlockHeight());
    }

    if (status.state === 'REVOKING' && status.revocation_effective_height) {
      return Math.max(0, status.revocation_effective_height - this.currentBlockHeight());
    }

    return 0;
  }

  getProgressPercentage(): number {
    const status = this.assignmentStatus();
    if (!status) return 0;

    // Assignment delay: 30 blocks (~1 hour), Revocation delay: 720 blocks (~1 day)
    const delayBlocks = status.state === 'REVOKING' ? 720 : 30;
    const remaining = this.getBlocksRemaining();
    const elapsed = delayBlocks - remaining;

    return Math.min(100, Math.max(0, (elapsed / delayBlocks) * 100));
  }

  getEstimatedTime(): string {
    const blocks = this.getBlocksRemaining();
    if (blocks <= 0) return '';

    // Bitcoin-PoCX: ~2 minutes per block
    const minutes = blocks * 2;

    if (minutes < 60) {
      return `~${minutes} ${this.i18n.get('minutes')}`;
    }

    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `~${hours} ${this.i18n.get('hours')}`;
    }

    const days = Math.round(hours / 24);
    return `~${days} ${this.i18n.get('days')}`;
  }
}
