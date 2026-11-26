Option Explicit

Dim shell, fileSystem, scriptDirectory, command, shortcutPath, shortcut
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)

' VBS files cannot carry a custom Explorer icon. Keep a shortcut beside the launcher.
shortcutPath = scriptDirectory & "\Nanoleaf.lnk"
Set shortcut = shell.CreateShortcut(shortcutPath)
shortcut.TargetPath = WScript.ScriptFullName
shortcut.WorkingDirectory = scriptDirectory
shortcut.IconLocation = scriptDirectory & "\assets\nanoleaf.ico,0"
shortcut.Description = "Start Nanoleaf"
shortcut.Save

command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDirectory & "\launch-nanoleaf.ps1"""
shell.Run command, 0, False
