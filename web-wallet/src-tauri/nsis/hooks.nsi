; Custom NSIS hooks for Phoenix PoCX Wallet
; This script adds a "Phoenix PoCX Miner" shortcut alongside the main wallet shortcut

!macro NSIS_HOOK_POSTINSTALL
  ; Create Mining-only mode shortcuts
  ; Start Menu shortcut (in same folder as main app)
  StrCmp $AppStartMenuFolder "" create_miner_shortcut_root create_miner_shortcut_folder

  create_miner_shortcut_folder:
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"
    Goto create_miner_desktop

  create_miner_shortcut_root:
    CreateShortcut "$SMPROGRAMS\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"

  create_miner_desktop:
    ; Desktop shortcut for mining mode
    CreateShortcut "$DESKTOP\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove Mining-only mode shortcuts during uninstall
  Delete "$SMPROGRAMS\$AppStartMenuFolder\Phoenix PoCX Miner.lnk"
  Delete "$SMPROGRAMS\Phoenix PoCX Miner.lnk"
  Delete "$DESKTOP\Phoenix PoCX Miner.lnk"
!macroend
