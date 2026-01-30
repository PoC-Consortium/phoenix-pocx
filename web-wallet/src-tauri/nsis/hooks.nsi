; Custom NSIS hooks for Phoenix PoCX Wallet
; This script adds a "Phoenix PoCX Miner" shortcut alongside the main wallet shortcut

!macro NSIS_HOOK_POSTINSTALL
  ; Create miner shortcut in Start Menu root (same location as main wallet shortcut)
  CreateShortcut "$SMPROGRAMS\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"

  ; Desktop shortcut for mining mode
  CreateShortcut "$DESKTOP\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove Mining-only mode shortcuts during uninstall
  Delete "$SMPROGRAMS\Phoenix PoCX Miner.lnk"
  Delete "$DESKTOP\Phoenix PoCX Miner.lnk"
!macroend
