; Put the install dir (holding claude-help.cmd) on the user PATH, and take it off on uninstall.
; The raw registry value is read and written so %VAR% entries in PATH stay unexpanded.

!macro customInstall
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d='$INSTDIR'; $$p=(Get-Item 'HKCU:\Environment').GetValue('Path','','DoNotExpandEnvironmentNames'); $$parts=@($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$d }); Set-ItemProperty 'HKCU:\Environment' -Name Path -Value (($$parts + $$d) -join ';') -Type ExpandString"`
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  ; an auto-update runs the old uninstaller first; keep PATH so the new install does not flicker it
  ${IfNot} ${isUpdated}
    nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d='$INSTDIR'; $$p=(Get-Item 'HKCU:\Environment').GetValue('Path','','DoNotExpandEnvironmentNames'); $$parts=@($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$d }); Set-ItemProperty 'HKCU:\Environment' -Name Path -Value ($$parts -join ';') -Type ExpandString"`
    SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}
!macroend
