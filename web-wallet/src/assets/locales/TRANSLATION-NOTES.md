# Translation Notes — 2.1.0 i18n quality pass

Scope: the **delta since `v2.0.4`** — **347 keys** (344 added, 3 re-worded) driven by
the PSBT Transaction Builder, the multisig wizard, and the nodeless / remote
(Electrum) wallet. `en.json` is the source of truth; the other 25 locales must
match its key set exactly.

This pass is **mechanical + consistency quality**, not a native-fluency
certification. The tables below tell native reviewers exactly where to look.

## What was already correct (previous session)

- **Key parity is perfect** — all 25 locales carry every one of the 347 delta
  keys (`check-keys.js` clean).
- **Zero placeholder mismatches** in the delta. Every `{param}` in `en`
  (`{seconds}`, `{threshold}`, `{total}`, `{count}`, `{name}`, `{branches}`,
  `{percent}`, `{signed}`, `{required}`, `{n}`, `{device}`, …) is present and
  intact in every locale.
- The `Bitcoin-PoCX` → `BTCX` rebrand of 3 strings
  (`address_invalid_format`, `watch_only_entry_hint`,
  `watch_only_entry_error_unknown`) is already reflected in all locales — no
  stale `PoCX` address tokens remain.

## What this pass changed

One whole feature block — the **nodeless / remote (Electrum) wallet + the
`move_up`/`move_down` reorder controls** (~30 keys) — was added to `en.json`
and then **copied verbatim (untranslated English) into ALL 25 locales**. This
pass translated that block for the 9 languages below (**271 string values**).
The 16 remaining locales keep the block as **English fallback**, flagged for
native translation (see the last table).

The block keys: `node_setup_remote_title`, `node_setup_remote_desc`,
`node_remote_node`, `electrum_servers`, `electrum_servers_desc`,
`electrum_primary_server_hint`, `electrum_primary_server`,
`electrum_test_connection`, `electrum_remove_server`, `electrum_no_servers_hint`,
`electrum_server_url`, `electrum_no_server_configured`,
`electrum_help_server_configured`, `electrum_help_server_reachable`,
`welcome_electrum_ready`, `electrum_status_healthy`, `electrum_status_degraded`,
`electrum_status_down`, `electrum_status_connecting`, `electrum_synced_ago`,
`wallet_name_invalid_local`, `wallet_name_hint_local`,
`wallet_encryption_info_local`, `restore_probe_info`,
`psbt_join_unavailable_remote`, `psbt_compose_advanced_unavailable_remote`,
`feature_unavailable_remote`, `setup_solo_not_available_remote`, `move_up`,
`move_down`. Plus `psbt_locktime` (pt-br only — was left as "Locktime" while its
hint was translated; unified to "Tempo de bloqueio").

## Terms that legitimately STAY English (all locales — not defects)

Proper nouns / protocol tokens, kept verbatim on purpose:
`BTCX`, `PoCX`, `Electrum`, `PSBT`, `SegWit`, `Taproot`, `BIP-84`, `BIP-86`,
`OP_RETURN`, `Locktime` (where a language has no settled term), `xpub`/`tpub`,
`WIF`, `tcp://host:port`, `ssl://host:port`.

Consequently these keys reading identically to English is **correct**, not a
miss: `mwallet_kind_segwit` ("SegWit (BIP-84)"), `mwallet_kind_taproot`
("Taproot (BIP-86)"), `mwallet_taproot_badge` ("taproot"), `mwallet_segwit_badge`
("segwit"), `mwallet_legacy_badge` ("legacy"). The three address-type **badges**
are kept as one English set for visual consistency; a reviewer may localise
`legacy` if desired, but keep the three consistent.

Also identical-by-cognate (correct in the target language, not English leftover):
`Manual`/`Experimental`/`mobile` in ES/PT/CA/GL/RO; `Actions`/`confirmations` in
FR; `Multisig` in DE/FR/IT/NL/PT/GL/RO (accepted borrowing; ES→"Multifirma",
CA→"Multisignatura"); `Passphrase` in DE/IT.

## Length / layout flags for narrow mobile UI

Reviewers of badge/button keys should sanity-check width — these render in
chips or tight buttons and are longer than English in several locales:
`move_up`/`move_down` (DE "Nach oben/unten", NL "Omhoog/Omlaag verplaatsen",
FR "Déplacer vers le haut/bas"), `electrum_test_connection`,
`electrum_status_*`. None were force-shortened; flag only.

## Per-language status

| Lang  | Confidence | Notes for native reviewer |
|-------|-----------|---------------------------|
| de-de | High (real corrections) | New strings use **proper umlauts (ü/ö/ä/ß)**. ⚠️ The file pre-existing mixes proper umlauts with `ue`/`oe`/`ae` transliteration (e.g. `Gebuehr`, `Zurueck`) — a legacy inconsistency; pick one convention project-wide. Kept `Wallet`, `Node`, `Remote`, `Multisig`, `Passphrase` as in the rest of the file. |
| es-es | High (real corrections) | Wallet = "billetera", seed = "semilla", fee = "comisión". `Multisig`→ file uses "Multifirma" elsewhere; block strings don't use the word. |
| fr    | High (real corrections) | New strings use **proper accents**. ⚠️ Some pre-existing keys strip accents (`Connecte`, `Deconnecte`, `Parametres`) — legacy inconsistency, normalise later. Wallet = "portefeuille", seed = "graine", node = "nœud". |
| it    | High (real corrections) | Wallet = "portafoglio", seed = "seed" (kept), fee = "commissione", locktime = "tempo di blocco", change = "resto". |
| nl    | High (real corrections) | ⚠️ File mixes "wallet" and "Portemonnee" for *wallet*; block strings use **"wallet"** (dominant in the PSBT/Electrum strings). seed = "seed", recovery phrase = "herstelzin", change = "wisselgeld". `data` (psbt tag) left as-is (valid NL). |
| pt-br | High (real corrections) | Wallet = "carteira", seed = "semente", fee = "taxa", change = "troco". Unified `psbt_locktime` → "Tempo de bloqueio". |
| ca    | Good (Romance) | Wallet = "moneder", seed = "llavor", change = "canvi", locktime = "temps de bloqueig". Imperative verb style ("Prova", "Elimina", "Mou") to match existing actions. Please spot-check. |
| gl    | Good (Romance) | Wallet = "carteira", seed = "semente", password = "contrasinal" (masc.), change = "cambio". Please spot-check gender/agreement. |
| ro    | Good (Romance) | Wallet = "portofel", seed = "seed" (kept), remote = "la distanță", change = "rest", failover = "de rezervă". Please spot-check diacritics (ș/ț). |
| bg, cs, el, fi, hi, hr, id, ja, lt, pl, ru, sk, sr, tr, uk, zh-cn | **Needs native review — mechanical only** | Parity + placeholders verified. The **remote/Electrum block (~30 keys, listed above) is left as ENGLISH FALLBACK** — not machine-translated, to avoid unverifiable fluency guesses. These need native translation. Also: `msig_of` ("of") in **ja** is a visible English leftover in "{required} of {total}" — translate. |

## Canonical glossary (languages translated this pass)

| EN | de-de | es-es | fr | it | nl | pt-br | ca | gl | ro |
|----|-------|-------|----|----|----|-------|----|----|----|
| wallet | Wallet | billetera | portefeuille | portafoglio | wallet | carteira | moneder | carteira | portofel |
| seed | Seed | semilla | graine | seed | seed | semente | llavor | semente | seed |
| recovery phrase | Wiederherstellungsphrase | frase de recuperación | phrase de récupération | frase di recupero | herstelzin | frase de recuperação | frase de recuperació | frase de recuperación | fraza de recuperare |
| server | Server | servidor | serveur | server | server | servidor | servidor | servidor | server |
| primary server | Primärer Server | servidor principal | serveur principal | server principale | primaire server | servidor principal | servidor principal | servidor principal | server principal |
| failover | Ausweichserver | de reserva | serveur de secours | di riserva | reserveserver | de reserva | de reserva | de reserva | de rezervă |
| remote (mode) | Remote | remoto | distant | remoto | extern / op afstand | remoto | remot | remoto | la distanță |
| node | Node | nodo | nœud | nodo | node | nó | node | nodo | nod |
| connection | Verbindung | conexión | connexion | connessione | verbinding | conexão | connexió | conexión | conexiune |
| connected | verbunden | conectado | connecté | connesso | verbonden | conectado | connectat | conectado | conectat |
| disconnected | getrennt | desconectado | déconnecté | disconnesso | niet verbonden | desconectado | desconnectat | desconectado | deconectat |
| fee | Gebühr | comisión | frais | commissione | vergoeding | taxa | comissió | comisión | comision |
| change (output) | Wechselgeld | cambio | monnaie | resto | wisselgeld | troco | canvi | cambio | rest |
| locktime | Sperrzeit | tiempo de bloqueo | temps de verrouillage | tempo di blocco | vergrendeltijd | tempo de bloqueio | temps de bloqueig | tempo de bloqueo | timp de blocare |
| solo mining | Solo-Mining | minería en solitario | minage en solo | mining in solo | solo-mining | mineração solo | mineria en solitari | minaría en solitario | minerit solo |
| move up / down | Nach oben / unten | Mover arriba / abajo | Déplacer vers le haut / bas | Sposta su / giù | Omhoog / Omlaag verplaatsen | Mover para cima / baixo | Mou amunt / avall | Mover arriba / abaixo | Mută în sus / jos |

## Verification

- `check-keys.js`: **all 25 files match en.json keys** (parity intact).
- Every locale file re-parsed with `JSON.parse` after edits — all valid.
- Placeholder audit over the delta: **0 mismatches** across 26 files.
- No test references the locale files (`*.spec.ts` grep clean), so the Karma
  suite exercises no i18n path; the change is JSON-value-only with unchanged
  key sets.
- `en.json` unchanged (source of truth preserved).
