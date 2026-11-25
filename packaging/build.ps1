<#
  Builds StellarHub.exe and the installer, from a clean environment, in one go:

      powershell -ExecutionPolicy Bypass -File packaging\build.ps1

  Result: dist\StellarHub-Setup-<version>.exe and dist\StellarHub-Portable-<version>.zip (each with its .sha256)
  Needs Python 3.12+ and Inno Setup 6.6+ (winget install JRSoftware.InnoSetup). Nothing is installed system-wide:
  the Python packages go into .buildenv, with the exact versions below.

  PyInstaller's bootloader (the stub every PyInstaller program starts with) is compiled from source for releases:
  the prebuilt one is the same bytes in thousands of programs, some of them malware, and antivirus machine-learning
  models flag programs that match it. This needs the C compiler of Visual Studio (Build Tools, "Desktop development
  with C++"):
      STELLARHUB_COMPILE_BOOTLOADER=1   compile it (the default when vswhere finds MSVC; =0 never)
      STELLARHUB_REQUIRE_COMPILED_BOOTLOADER=1   fail instead of warning when the result is the prebuilt one
                                                  (GitHub Actions sets both: releases always come from there)
  Without a compiler a local build keeps the prebuilt bootloader and says so: local builds are not released.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$pyi = "pyinstaller==6.22.3"
$pins = "pywebview==6.2.1", "pythonnet==3.2.1", "psutil==7.2.2", "pystray==0.19.5", "pillow==12.3.0",
        "pyinstaller-hooks-contrib==2026.9"
$version = (Select-String -Path stellarhub\__init__.py -Pattern 'VERSION = "(.+)"').Matches[0].Groups[1].Value
Write-Host "StellarHub $version" -ForegroundColor Cyan
New-Item -ItemType Directory -Force build\logs | Out-Null

# Runs a program with its output in build\logs\<step>.log. Not through a pipe on purpose: a process left running by
# a test (the uninstaller tests start a "ping" on purpose) would keep the pipe open and the build would never end.
function Run([string]$name, [string]$exe, [string[]]$argv) {
    Write-Host "  $name..."
    $log = "build\logs\$name.log"
    $p = Start-Process -FilePath $exe -ArgumentList $argv -NoNewWindow -PassThru `
        -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    $null = $p.Handle  # Windows PowerShell only keeps the exit code if the handle was read
    $p.WaitForExit()
    return $p.ExitCode
}
function Step([string]$name, [string]$exe, [string[]]$argv) {
    $code = Run $name $exe $argv
    if ($code -ne 0) {
        $log = "build\logs\$name.log"
        Get-Content $log, "$log.err" -Tail 25 -ErrorAction SilentlyContinue
        throw "$name failed (exit code $code); see $log"
    }
}

# 1. clean build environment (only what StellarHub needs, so only that ends up in the exe)
$py = "$root\.buildenv\Scripts\python.exe"
# a Python 3.12+ for it, even when an older one comes first in PATH: the py launcher's newest, then PATH's
function Find-Python {
    foreach ($c in @(@("py", "-3"), @("python"), @("python3"))) {
        if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { continue }
        $exe = & $c[0] @($c | Select-Object -Skip 1) -c "import sys; print(sys.executable if sys.version_info >= (3, 12) else '')" 2>$null
        if ($LASTEXITCODE -eq 0 -and $exe) { return "$exe".Trim() }
    }
    throw "Python 3.12 or newer was not found (py -3, python, python3): install it from python.org or with winget install Python.Python.3.13"
}
if (-not (Test-Path $py)) {
    $base = Find-Python
    Write-Host "Creating .buildenv with $base..."
    Step "venv" $base @("-m", "venv", ".buildenv")
}
$v = & $py -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ([version]$v -lt [version]"3.12") { throw ".buildenv has Python $v, StellarHub needs 3.12+: delete the .buildenv folder and run this again" }
Step "pip" $py (@("-m", "pip", "install", "--disable-pip-version-check") + $pins)

# 1b. PyInstaller with its own bootloader, compiled here from the sdist (see the header)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$msvc = $null
if (Test-Path $vswhere) {
    $msvc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
$compile = switch ($env:STELLARHUB_COMPILE_BOOTLOADER) { "1" { $true } "0" { $false } default { [bool]$msvc } }
$require = $env:STELLARHUB_REQUIRE_COMPILED_BOOTLOADER -eq "1"
if ($compile -and -not $msvc) { throw "STELLARHUB_COMPILE_BOOTLOADER=1 but no Visual Studio C++ compiler was found (vswhere): install the Build Tools with the C++ workload" }
$compiled = $false
if ($compile) {
    $compiled = (Run "bootloader-check" $py @("packaging\check_bootloader.py")) -eq 0  # already compiled in .buildenv?
    if (-not $compiled) {
        Write-Host "  compiling PyInstaller's bootloader with $msvc (a few minutes)..."
        $null = Run "pyinstaller-uninstall" $py @("-m", "pip", "uninstall", "-y", "pyinstaller")
        $env:PYINSTALLER_COMPILE_BOOTLOADER = "1"
        try {
            Step "pyinstaller-compile" $py @("-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir", "--verbose",
                                              "--no-binary", "pyinstaller", $pyi)
        } finally { Remove-Item Env:\PYINSTALLER_COMPILE_BOOTLOADER -ErrorAction SilentlyContinue }
    }
} else {
    Step "pyinstaller-install" $py @("-m", "pip", "install", "--disable-pip-version-check", $pyi)
}
# a compile that silently fell back to the prebuilt bootloader must never go unnoticed: compare with the official wheel
$compiled = (Run "bootloader-check" $py @("packaging\check_bootloader.py")) -eq 0
Get-Content "build\logs\bootloader-check.log" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
if ($compiled) {
    Write-Host "  Bootloader: compiled from source." -ForegroundColor Green
} elseif ($require -or $compile) {
    throw "The PyInstaller bootloader is the prebuilt one although a compiled one was required (see build\logs\bootloader-check.log and pyinstaller-compile.log)"
} else {
    Write-Warning "No C compiler found: this build uses PyInstaller's PREBUILT bootloader, which antivirus machine-learning models flag more often. Fine for local testing; releases are built on GitHub Actions with a compiled one (install Visual Studio Build Tools with the C++ workload, or set STELLARHUB_COMPILE_BOOTLOADER=1, to do it here)."
}

# 2. tests first: never package a broken engine
Step "tests" $py @("-m", "unittest", "discover", "-s", "tests", "-t", ".")
Get-Content "build\logs\tests.log.err" -Tail 1

# 3. icon, installer artwork, version resource (CompanyName, FileDescription, ProductName, LegalCopyright,
#    OriginalFilename: packaging\StellarHub.manifest is the application manifest), code statistics
Step "assets" $py @("packaging\make_assets.py")

# 4. StellarHub.exe (one folder, no UPX: see the notes in StellarHub.spec)
Step "pyinstaller" $py @("-m", "PyInstaller", "packaging\StellarHub.spec", "--noconfirm", "--clean", "--log-level", "WARN",
                         "--distpath", "build\dist", "--workpath", "build\work")
# next to StellarHub.exe: lets .NET load pythonnet from a portable copy extracted by Explorer (see the file)
Copy-Item "packaging\StellarHub.exe.config" "build\dist\StellarHub\StellarHub.exe.config" -Force

# 5. the installer (it downloads the WebView2 bootstrapper from Microsoft itself, only on PCs that lack WebView2)
$iscc = @($env:STELLARHUB_ISCC, "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
          "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup not found: winget install JRSoftware.InnoSetup" }
Step "installer" $iscc @("/Q", "/DAppVersion=$version", "packaging\StellarHub.iss")

# 6. the portable version: the same program in a .zip, with the marker that keeps its data next to it
Step "portable" $py @("packaging\make_portable.py")
Get-Content "build\logs\portable.log" -Tail 2

$out = Get-Item "dist\StellarHub-Setup-$version.exe"
$hash = (Get-FileHash $out -Algorithm SHA256).Hash
Set-Content "dist\StellarHub-Setup-$version.exe.sha256" "$hash  $($out.Name)" -Encoding ascii
Write-Host ("Done: {0} ({1:N1} MB)`nSHA-256 {2}" -f $out.FullName, ($out.Length / 1MB), $hash) -ForegroundColor Green
