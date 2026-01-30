; Custom NSIS hooks for Phoenix PoCX Wallet
; This script adds a "Phoenix PoCX Miner" shortcut alongside the main wallet shortcut

!macro NSIS_HOOK_POSTINSTALL
  ; Create Mining-only mode shortcuts on fresh install (not updates)

  ; Start Menu shortcut
  ${IfNot} $NoShortcutMode = 1
    StrCmp $AppStartMenuFolder "" miner_start_menu_root miner_start_menu_folder
    miner_start_menu_folder:
      CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"
      Goto miner_desktop
    miner_start_menu_root:
      CreateShortcut "$SMPROGRAMS\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"
  ${EndIf}

  miner_desktop:
  ; Desktop shortcut - only in silent/passive mode
  ; Interactive installs use finish page checkbox which we can't hook into
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${IfNot} $NoShortcutMode = 1
      CreateShortcut "$DESKTOP\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove Mining-only mode shortcuts during uninstall
  Delete "$SMPROGRAMS\$AppStartMenuFolder\Phoenix PoCX Miner.lnk"
  Delete "$SMPROGRAMS\Phoenix PoCX Miner.lnk"
  Delete "$DESKTOP\Phoenix PoCX Miner.lnk"
!macroend
