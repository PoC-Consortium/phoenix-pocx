; Custom NSIS hooks for Phoenix PoCX Wallet
; This script adds a "Phoenix PoCX Miner" shortcut alongside the main wallet shortcut
; Uses identical conditions as main app shortcuts for consistent behavior

!macro NSIS_HOOK_POSTINSTALL
  ; Create Mining-only mode shortcuts using same conditions as main app

  ; Start Menu shortcut - same conditions as CreateOrUpdateStartMenuShortcut
  ; Skip if: (not WixMode) AND (UpdateMode OR NoShortcutMode)
  ${If} $WixMode = 1
  ${OrIfNot} $UpdateMode = 1
  ${AndIfNot} $NoShortcutMode = 1
    StrCmp $AppStartMenuFolder "" miner_start_menu_root miner_start_menu_folder
    miner_start_menu_folder:
      CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"
      Goto miner_desktop
    miner_start_menu_root:
      CreateShortcut "$SMPROGRAMS\Phoenix PoCX Miner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--mining-only"
  ${EndIf}

  miner_desktop:
  ; Desktop shortcut - same conditions as main app (silent/passive only)
  ; Interactive installs use finish page checkbox which we can't hook into
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${If} $WixMode = 1
    ${OrIfNot} $UpdateMode = 1
    ${AndIfNot} $NoShortcutMode = 1
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
