import { Injectable, signal } from '@angular/core';
import { validatePocxAddress } from '../../bitcoin/utils/address-validation';
import type { Network } from '../../store/settings/settings.state';

/**
 * One address-book entry — the exact shape the desktop contacts page
 * persists (features/contacts), including the per-network split.
 */
export interface Contact {
  id: string;
  name: string;
  address: string;
  notes?: string;
  createdAt: number;
  network: Network;
}

const STORAGE_KEY = 'wallet_contacts';

/**
 * ContactsStoreService — signal-based access to the SAME `wallet_contacts`
 * localStorage book the desktop contacts page (and the desktop send /
 * PSBT-compose pickers) read and write. No new persistence: the mobile
 * wallet reuses the existing store, so contacts travel between the
 * desktop and mobile surfaces of one install.
 *
 * The desktop pages keep their own inline localStorage access; both sides
 * re-read on entry (`load()`), so writes never fight.
 */
@Injectable({ providedIn: 'root' })
export class ContactsStoreService {
  private readonly _contacts = signal<Contact[]>([]);
  readonly contacts = this._contacts.asReadonly();

  constructor() {
    this.load();
  }

  /** Re-read the book from localStorage (desktop-parity legacy migration). */
  load(): void {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      this._contacts.set([]);
      return;
    }
    try {
      const raw = JSON.parse(stored) as (Omit<Contact, 'network'> & { network?: Network })[];
      const migrated: Contact[] = raw.map(c => {
        if (c.network) return c as Contact;
        // Legacy entry — infer the network from the address itself (same
        // migration the desktop contacts page runs).
        const result = validatePocxAddress(c.address);
        const network: Network = result.kind === 'valid' ? result.network : 'mainnet';
        return { ...c, network };
      });
      migrated.sort((a, b) => a.name.localeCompare(b.name));
      this._contacts.set(migrated);
    } catch {
      // Invalid data — leave whatever we had.
    }
  }

  /** Contacts of one network, sorted by name. */
  forNetwork(network: Network): Contact[] {
    return this._contacts().filter(c => c.network === network);
  }

  /** True when `address` is already in the book on `network` (case-insensitive). */
  hasAddress(network: Network, address: string, exceptId?: string): boolean {
    const needle = address.trim().toLowerCase();
    return this._contacts().some(
      c => c.network === network && c.id !== exceptId && c.address.toLowerCase() === needle
    );
  }

  add(network: Network, name: string, address: string, notes?: string): Contact {
    const contact: Contact = {
      id: Date.now().toString(),
      name: name.trim(),
      address: address.trim(),
      notes: notes?.trim() || undefined,
      createdAt: Date.now(),
      network,
    };
    this._contacts.update(list => [...list, contact].sort((a, b) => a.name.localeCompare(b.name)));
    this.save();
    return contact;
  }

  update(id: string, name: string, address: string, notes?: string): void {
    this._contacts.update(list =>
      list
        .map(c =>
          c.id === id
            ? {
                ...c,
                name: name.trim(),
                address: address.trim(),
                notes: notes?.trim() || undefined,
              }
            : c
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    this.save();
  }

  remove(id: string): void {
    this._contacts.update(list => list.filter(c => c.id !== id));
    this.save();
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._contacts()));
  }
}
