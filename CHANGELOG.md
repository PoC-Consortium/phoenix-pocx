# Phoenix Wallet 2.3.1

A patch release completing what 2.3.0 set out to deliver: the Transaction Builder and the Receive screen now work the same in nodeless (Electrum) mode as they do with a local node, and fee handling got precise.

## Transaction Builder — full power in Electrum mode

- **Coin control, OP_RETURN data, and locktime** now work when composing without a local node — everything is built client-side from your own wallet. (A custom change address remains node-only; the option is hidden in nodeless mode.)
- **Spending exact coins with Max** works correctly: select a coin, hit Max, and the transaction drains exactly that coin minus the real fee — no more "insufficient funds" from the fee being counted twice.
- The **review step shows the fee rate** before signing, in every mode.
- When your signature completes a transaction, it is **sealed in the same step** — straight to Broadcast, no separate finalize tap. (Multi-party signing keeps the explicit combine/finalize stop.)

## Fees, precise

- A **custom fee rate of 0.1 sat/vB is honored** end to end — previously anything below 1 sat/vB was silently raised. Presets and automatic estimates still never go below 1 sat/vB.
- The Builder's **estimated fee follows the custom rate as you type**, and Send and the Builder now quote the same estimate for the same transaction.
- The confirm dialog says **BTCX** (it said "BTC"), centered over the page.

## Receive — your addresses, everywhere

- In nodeless (Electrum) mode the Receive screen now lists **every address your wallet has revealed** — newest first, used ones tagged — instead of only the current fresh address. All derived locally, with no extra server traffic.
