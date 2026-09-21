Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Gamer\OpenCluely"
WshShell.Run """C:\Users\Gamer\OpenCluely\node_modules\electron\dist\electron.exe"" .", 1, False
