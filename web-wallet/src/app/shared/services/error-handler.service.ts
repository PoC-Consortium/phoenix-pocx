import { Injectable, inject, ErrorHandler } from '@angular/core';
import { NotificationService } from './notification.service';

/**
 * Error categories for better handling
 */
export type ErrorCategory = 'rpc' | 'network' | 'wallet' | 'validation' | 'auth' | 'unknown';

/**
 * Parsed error information
 */
export interface ParsedError {
  category: ErrorCategory;
  message: string;
  code?: number;
  details?: unknown;
  originalError: unknown;
}

/**
 * ErrorHandlerService provides centralized error handling and reporting.
 */
@Injectable({ providedIn: 'root' })
export class ErrorHandlerService implements ErrorHandler {
  private readonly notification = inject(NotificationService);

  /**
   * Handle an error (Angular ErrorHandler interface)
   */
  handleError(error: unknown): void {
    const parsed = this.parseError(error);
    console.error(`[${parsed.category.toUpperCase()}] ${parsed.message}`, parsed.originalError);

    // Show user-friendly notification
    this.notification.error(parsed.message);
  }

  /**
   * Parse an error into a standardized format
   */
  parseError(error: unknown): ParsedError {
    // Handle Error objects
    if (error instanceof Error) {
      return this.parseErrorMessage(error.message, error);
    }

    // Handle string errors
    if (typeof error === 'string') {
      return this.parseErrorMessage(error, error);
    }

    // Handle objects with message property
    if (error && typeof error === 'object' && 'message' in error) {
      return this.parseErrorMessage(String((error as { message: unknown }).message), error);
    }

    // Unknown error type
    return {
      category: 'unknown',
      message: 'An unexpected error occurred',
      originalError: error,
    };
  }

  /**
   * Parse error message to determine category and clean message
   */
  private parseErrorMessage(message: string, originalError: unknown): ParsedError {
    const lowerMessage = message.toLowerCase();

    // RPC errors
    if (lowerMessage.includes('rpc error') || lowerMessage.includes('rpc ')) {
      const codeMatch = message.match(/RPC Error (-?\d+)/i);
      return {
        category: 'rpc',
        message: this.cleanRpcError(message),
        code: codeMatch ? parseInt(codeMatch[1], 10) : undefined,
        originalError,
      };
    }

    // Network errors
    if (
      lowerMessage.includes('network') ||
      lowerMessage.includes('connect') ||
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('cannot connect')
    ) {
      return {
        category: 'network',
        message: this.cleanNetworkError(message),
        originalError,
      };
    }

    // Authentication errors
    if (
      lowerMessage.includes('auth') ||
      lowerMessage.includes('credential') ||
      lowerMessage.includes('401') ||
      lowerMessage.includes('forbidden')
    ) {
      return {
        category: 'auth',
        message: 'Authentication failed. Please check your credentials.',
        originalError,
      };
    }

    // Wallet errors
    if (
      lowerMessage.includes('wallet') ||
      lowerMessage.includes('insufficient') ||
      lowerMessage.includes('balance')
    ) {
      return {
        category: 'wallet',
        message: this.cleanWalletError(message),
        originalError,
      };
    }

    // Validation errors
    if (
      lowerMessage.includes('invalid') ||
      lowerMessage.includes('validation') ||
      lowerMessage.includes('required')
    ) {
      return {
        category: 'validation',
        message,
        originalError,
      };
    }

    // Default
    return {
      category: 'unknown',
      message,
      originalError,
    };
  }

  /**
   * Clean RPC error message for display
   */
  private cleanRpcError(message: string): string {
    // Remove "RPC Error XXX: " prefix
    const cleaned = message.replace(/RPC Error -?\d+:\s*/i, '');
    return this.capitalizeFirst(cleaned);
  }

  /**
   * Clean network error message for display
   */
  private cleanNetworkError(message: string): string {
    if (message.toLowerCase().includes('cannot connect')) {
      return 'Cannot connect to Bitcoin Core. Please ensure it is running.';
    }
    if (message.toLowerCase().includes('timeout')) {
      return 'Connection timed out. Please try again.';
    }
    return this.capitalizeFirst(message);
  }

  /**
   * Clean wallet error message for display
   */
  private cleanWalletError(message: string): string {
    if (message.toLowerCase().includes('insufficient')) {
      return 'Insufficient funds for this transaction.';
    }
    return this.capitalizeFirst(message);
  }

  /**
   * Capitalize first letter
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
