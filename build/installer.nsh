; electron-builder 约定：存在 build/installer.nsh 时会自动 include 进 NSIS 安装脚本。
;
; 应用运行时有两个同名进程：主窗口进程，以及以 ELECTRON_RUN_AS_NODE 方式跑 Next 服务的子进程。
; 后者没有窗口，安装器默认的「发消息关闭窗口」对它无效，会一直卡在
; 「CRM-Admin 无法关闭。请手动关闭它，然后单击重试以继续。」
; 这里在安装 / 卸载开始前，直接按进程名连进程树一起结束掉，
; 并用 tasklist 复核一次：结束不掉就提示用户手动退出后重试，而不是带着占用继续装。
;
; 宏会在安装器与卸载器里各展开一次，标签名必须带唯一后缀，否则 NSIS 报标签重复。

!macro CloseRunningApp ID
  Push $0
  Push $1
  Push $R7
  StrCpy $R7 0

  kill_${ID}:
    nsExec::Exec 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $0
    Sleep 800
    ; find 的退出码：0 = 还能匹配到进程，非 0 = 已经没有了
    nsExec::ExecToStack 'cmd /c tasklist /NH /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" 2>nul | find /I "${APP_EXECUTABLE_FILENAME}"'
    Pop $0
    Pop $1
    StrCmp $0 "0" running_${ID} done_${ID}

  running_${ID}:
    IntOp $R7 $R7 + 1
    ; 前两次自动重杀（服务子进程偶尔比主进程晚一步退出）
    IntCmp $R7 3 0 kill_${ID} 0
    ; 静默安装没人应答对话框，直接放行，交给后续步骤报错
    IfSilent done_${ID}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "检测到 ${PRODUCT_NAME} 仍在运行，无法自动结束。$\r$\n请手动退出程序（含托盘图标）后点「重试」。" IDRETRY reset_${ID}
    Abort

  reset_${ID}:
    StrCpy $R7 0
    Goto kill_${ID}

  done_${ID}:
    Pop $R7
    Pop $1
    Pop $0
!macroend

!macro customInit
  !insertmacro CloseRunningApp "install"
!macroend

!macro customUnInit
  !insertmacro CloseRunningApp "uninstall"
!macroend
