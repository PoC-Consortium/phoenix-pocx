# Phoenix Wallet 2.3.2

A small patch on 2.3.1.

## Fixed

- **Tablet dashboard flicker.** On mid-sized screens (tablets in landscape, mid-width windows) the dashboard's Recent Transactions table could oscillate between layouts several times a second — the row count and the column widths were feeding back into each other. The table now uses fixed column sizing with tidy single-line rows (long addresses and transaction ids shorten with an ellipsis; the full values are one tap away). The same hardening is applied to the Transactions page.
