<powershell>
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$logPath = 'C:\ProgramData\Amazon\EC2-Windows\Launch\Log\RokTracker-bootstrap.log'
Start-Transcript -Path $logPath -Append

function Write-Step($msg) {
  Write-Host "[RokTracker Bootstrap] $msg"
}

Write-Step 'Creating working directories'
New-Item -ItemType Directory -Force -Path 'C:\RokTracker' | Out-Null
New-Item -ItemType Directory -Force -Path 'C:\RokTracker\deps\tessdata' | Out-Null
New-Item -ItemType Directory -Force -Path 'C:\RokTracker\deps\platform-tools' | Out-Null

Write-Step 'Installing Chocolatey'
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
$env:Path += ';C:\ProgramData\chocolatey\bin'

Write-Step 'Installing Git + Python 3.11 + VC++ redistributable'
choco install -y git python --version=3.11.9 vcredist140

Write-Step 'Refreshing PATH'
$env:Path += ';C:\Python311;C:\Python311\Scripts;C:\Program Files\Git\cmd'

Write-Step 'Cloning RokTracker repository'
if (Test-Path 'C:\RokTracker\repo') {
  Remove-Item -Recurse -Force 'C:\RokTracker\repo'
}
git clone https://github.com/Cyrexxis/RokTracker.git C:\RokTracker\repo

Write-Step 'Creating Python venv and installing dependencies'
python -m venv C:\RokTracker\venv
& C:\RokTracker\venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
& C:\RokTracker\venv\Scripts\pip.exe install -r C:\RokTracker\repo\requirements_win64.txt

Write-Step 'Downloading Android platform-tools'
$ptZip = 'C:\RokTracker\platform-tools.zip'
Invoke-WebRequest -UseBasicParsing -Uri 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $ptZip
Expand-Archive -Path $ptZip -DestinationPath 'C:\RokTracker\deps' -Force
Remove-Item -Force $ptZip

Write-Step 'Downloading Tesseract traineddata (eng + osd)'
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata' -OutFile 'C:\RokTracker\deps\tessdata\eng.traineddata'
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/tesseract-ocr/tessdata/raw/main/osd.traineddata' -OutFile 'C:\RokTracker\deps\tessdata\osd.traineddata'

Write-Step 'Copying prepared deps into repository layout'
New-Item -ItemType Directory -Force -Path 'C:\RokTracker\repo\deps' | Out-Null
if (-not (Test-Path 'C:\RokTracker\repo\deps\inputs')) {
  New-Item -ItemType Directory -Force -Path 'C:\RokTracker\repo\deps\inputs' | Out-Null
}
Copy-Item -Recurse -Force 'C:\RokTracker\deps\platform-tools' 'C:\RokTracker\repo\deps\'
Copy-Item -Recurse -Force 'C:\RokTracker\deps\tessdata' 'C:\RokTracker\repo\deps\'

Write-Step 'Writing quick-start guide'
@"
RokTracker is installed at C:\RokTracker\repo
Python venv: C:\RokTracker\venv

Activate venv:
  C:\RokTracker\venv\Scripts\activate

Run scanner:
  python C:\RokTracker\repo\kingdom_scanner_ui.py

You still need to install and configure BlueStacks or LDPlayer manually,
then update C:\RokTracker\repo\config.json if needed.
"@ | Out-File -FilePath 'C:\RokTracker\README-EC2-SETUP.txt' -Encoding UTF8 -Force

Write-Step 'Bootstrap complete'
Stop-Transcript
</powershell>
