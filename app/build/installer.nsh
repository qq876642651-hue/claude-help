; Versions up to 1.2 shipped the cchelp command line and put the install dir on the user PATH.
; Installing this version cleans that up: take the install dir off PATH and remove the old cchelp files.
; The raw registry value is read and written so %VAR% entries in PATH stay unexpanded.

!macro removeFromPath
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d='$INSTDIR'; $$p=(Get-Item 'HKCU:\Environment').GetValue('Path','','DoNotExpandEnvironmentNames'); $$parts=@($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$d }); if ($$parts.Count -ne @($$p -split ';' | Where-Object { $$_ }).Count) { Set-ItemProperty 'HKCU:\Environment' -Name Path -Value ($$parts -join ';') -Type ExpandString }"`
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customInstall
  !insertmacro removeFromPath
  Delete "$INSTDIR\cchelp.cmd"
  Delete "$INSTDIR\cchelp"
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro removeFromPath
  ${EndIf}
!macroend
