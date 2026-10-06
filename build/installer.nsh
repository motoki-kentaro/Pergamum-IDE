; electron-builder 26.15.3 assisted installer: one opt-in page before INSTFILES.
!include MUI2.nsh
!include nsDialogs.nsh

; Keep electron-builder's bundled language policy. English fallback for languages
; without a translation, matching builder's own custom-message fallback policy.
!macro PergamumMarkdownEnglish LANG
  LangString PergamumMarkdownTitle ${LANG} "Markdown files"
  LangString PergamumMarkdownDescription ${LANG} "Choose whether to add Pergamum to Open with."
  LangString PergamumMarkdownCheckbox ${LANG} "Allow Markdown files (.md) to open with Pergamum"
  LangString PergamumMarkdownHint ${LANG} "Your default application will not be changed."
!macroend

!insertmacro PergamumMarkdownEnglish 1033 ; English
!insertmacro PergamumMarkdownEnglish 1031 ; German
!insertmacro PergamumMarkdownEnglish 1036 ; French
!insertmacro PergamumMarkdownEnglish 3082 ; Spanish
!insertmacro PergamumMarkdownEnglish 2052 ; Simplified Chinese
!insertmacro PergamumMarkdownEnglish 1028 ; Traditional Chinese
!insertmacro PergamumMarkdownEnglish 1042 ; Korean
!insertmacro PergamumMarkdownEnglish 1040 ; Italian
!insertmacro PergamumMarkdownEnglish 1043 ; Dutch
!insertmacro PergamumMarkdownEnglish 1030 ; Danish
!insertmacro PergamumMarkdownEnglish 1053 ; Swedish
!insertmacro PergamumMarkdownEnglish 1044 ; Norwegian
!insertmacro PergamumMarkdownEnglish 1035 ; Finnish
!insertmacro PergamumMarkdownEnglish 1049 ; Russian
!insertmacro PergamumMarkdownEnglish 2070 ; Portuguese
!insertmacro PergamumMarkdownEnglish 1046 ; Brazilian Portuguese
!insertmacro PergamumMarkdownEnglish 1045 ; Polish
!insertmacro PergamumMarkdownEnglish 1058 ; Ukrainian
!insertmacro PergamumMarkdownEnglish 1029 ; Czech
!insertmacro PergamumMarkdownEnglish 1051 ; Slovak
!insertmacro PergamumMarkdownEnglish 1038 ; Hungarian
!insertmacro PergamumMarkdownEnglish 1025 ; Arabic
!insertmacro PergamumMarkdownEnglish 1055 ; Turkish
!insertmacro PergamumMarkdownEnglish 1054 ; Thai
!insertmacro PergamumMarkdownEnglish 1066 ; Vietnamese
LangString PergamumMarkdownTitle 1041 "Markdown ファイル"
LangString PergamumMarkdownDescription 1041 "Pergamum を「プログラムから開く」の候補に追加するか選択してください。"
LangString PergamumMarkdownCheckbox 1041 "Markdown ファイル（.md）を Pergamum で開けるようにする"
LangString PergamumMarkdownHint 1041 "既定のアプリは変更されません。"

!ifndef BUILD_UNINSTALLER
  Var PergamumMarkdownCheckbox
  Var PergamumMarkdownSelected

  !macro customInit
    ; Also stays OFF for silent installs, where the page is never visited.
    StrCpy $PergamumMarkdownSelected ${BST_UNCHECKED}
  !macroend

  !macro customPageAfterChangeDir
    Page custom PergamumMarkdownPage PergamumMarkdownPageLeave
  !macroend

  Function PergamumMarkdownPage
    !insertmacro MUI_HEADER_TEXT "$(PergamumMarkdownTitle)" "$(PergamumMarkdownDescription)"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 0 100% 24u "$(PergamumMarkdownCheckbox)"
    Pop $PergamumMarkdownCheckbox
    ${NSD_SetState} $PergamumMarkdownCheckbox $PergamumMarkdownSelected
    ${NSD_CreateLabel} 0 32u 100% 24u "$(PergamumMarkdownHint)"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function PergamumMarkdownPageLeave
    ${NSD_GetState} $PergamumMarkdownCheckbox $PergamumMarkdownSelected
  FunctionEnd

  !macro customInstall
    ${If} $PergamumMarkdownSelected == ${BST_CHECKED}
      ; SHCTX follows the installer's own scope: HKCU for a per-user install
      ; (no elevation needed), HKLM for an all-users install. This is the same
      ; root electron-builder uses for the .pergamum file association.
      WriteRegStr SHCTX "Software\Classes\Pergamum.Markdown" "" "Markdown Document"
      WriteRegStr SHCTX "Software\Classes\Pergamum.Markdown\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
      WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "Pergamum.Markdown" ""
      System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
    ${EndIf}
  !macroend
!endif

!macro customUnInstall
  ; Only remove registration owned by this installation (same scope as install).
  ReadRegStr $0 SHCTX "Software\Classes\Pergamum.Markdown\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
    DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "Pergamum.Markdown"
    DeleteRegKey SHCTX "Software\Classes\Pergamum.Markdown"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
