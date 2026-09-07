; Attendance List — installer customisation
;
; Two jobs, both about not destroying people's records.
;
; Up to version 2.1.0 the database lived in a "data" folder inside the
; installation directory. electron-builder's uninstaller ends with
;
;     RMDir /r $INSTDIR
;
; and it runs on every update, so each update deleted the attendance history
; and all fourteen daily backups along with the old program files.
;
; customInit runs in .onInit, before the install section calls
; uninstallOldVersion, so it is the last moment at which that folder still
; exists. It moves the data somewhere the uninstaller does not reach.
;
; customRemoveFiles then makes the uninstaller itself spare the folder, so
; an installation that still has data beside the .exe for any reason keeps it.
;
; APPDATA_FOLDER must match APP_FOLDER in src/main/paths.js.

!define APPDATA_FOLDER "attendance-list"

; A named variable rather than a scratch register: the code this macro sits
; inside uses $R0-$R3, and a clash here would be silent and destructive.
Var /GLOBAL hadAttendanceData

!macro customInit
  ; $INSTDIR is already the existing installation at this point: initMultiUser
  ; has read it back from the registry.
  ${if} ${FileExists} "$INSTDIR\data\attendance.db"
    DetailPrint "Preserving attendance data from a previous version..."

    CreateDirectory "$APPDATA\${APPDATA_FOLDER}"

    ${ifNot} ${FileExists} "$APPDATA\${APPDATA_FOLDER}\data\attendance.db"
      ; Copy rather than move. If anything goes wrong the records are still
      ; in the old place, right up until the uninstaller clears it.
      CopyFiles /SILENT "$INSTDIR\data" "$APPDATA\${APPDATA_FOLDER}"
      DetailPrint "Attendance data preserved."
    ${else}
      DetailPrint "Attendance data already present, left untouched."
    ${endif}
  ${endif}
!macroend

!macro customRemoveFiles
  ; Everything electron-builder's default branch does, except that the data
  ; folder is carried across the wipe and put back afterwards.
  StrCpy $hadAttendanceData "0"
  ${if} ${FileExists} "$INSTDIR\data\*.*"
    StrCpy $hadAttendanceData "1"
    CreateDirectory "$PLUGINSDIR\attendance-data"
    CopyFiles /SILENT "$INSTDIR\data" "$PLUGINSDIR\attendance-data"
  ${endif}

  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"

      Push ""
      Call un.restoreFiles
      Pop $R0

      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}
  ${endif}

  SetOutPath $TEMP
  RMDir /r $INSTDIR

  ${if} $hadAttendanceData == "1"
    CreateDirectory "$INSTDIR"
    CopyFiles /SILENT "$PLUGINSDIR\attendance-data\data" "$INSTDIR"
  ${endif}
!macroend
