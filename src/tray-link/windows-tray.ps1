# Vaultgate tray. C#/WinForms, gecompileerd door Windows PowerShell 5.1 (CodeDom, .NET Framework 4.8: niets te
# installeren). Gestart door het proxy-proces (src/tray-link/index.js), dat de pipe-server is.
# Dit script en de C#-bron (Theme.cs, Tray.cs, Popup.cs) komen NIET van schijf: het proxy-proces geeft de bytes die het bij
# de start las en controleerde (src/code-integrity) via stdin, en PowerShell compileert ze uit het geheugen. Een bestand dat
# na die controle op schijf verandert, wordt dus niet uitgevoerd. Daarna leest het script een JSON-regel van stdin:
# { pipeName, token, portal } (niet via argv: zichtbaar voor andere processen).
#
# Protocol (JSON per regel): proxy -> tray { type: 'ask', id, tool, secret, host, client, method, path, timeoutMs, variant, sensitive?, manualKey? },
# { type: 'state', locked, pending: [...] } en { type: 'notify', title, text }; tray -> proxy { type: 'hello', token },
# { type: 'answer', id, answer: once|30m|1h|always|deny|timeout }, { type: 'lock' } (portaal dicht), { type: 'logout' } (kluis dicht), { type: 'open-portal' }.
# Nooit een secret-waarde: het protocol heeft er geen veld voor.
#
# KS_TRAY_SNAPSHOT_DIR (alleen voor de probe en de screenshots in docs/screenshots): elke pop-up en het menu tekenen zichzelf
# als PNG in die map, en de toestand komt in state.json. Zonder die variabele schrijft de tray niets naar schijf.
param([string[]]$Sources)
$ErrorActionPreference = 'Stop'
$options = New-Object System.CodeDom.Compiler.CompilerParameters
$options.GenerateInMemory = $true
[void]$options.ReferencedAssemblies.AddRange([string[]]('System.dll', 'System.Core.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll', 'System.Web.Extensions.dll'))
$compiled = (New-Object Microsoft.CSharp.CSharpCodeProvider).CompileAssemblyFromSource($options, $Sources)
if ($compiled.Errors.HasErrors) { $compiled.Errors | ForEach-Object { [Console]::Error.WriteLine($_.ToString()) }; exit 3 }
$init = [Console]::In.ReadLine() | ConvertFrom-Json
$texts = if ($null -ne $init.texts) { $init.texts | ConvertTo-Json -Compress } else { '{}' }
exit [KsTray]::Run($init.pipeName, $init.token, $init.portal, $env:KS_TRAY_SNAPSHOT_DIR, $texts)
