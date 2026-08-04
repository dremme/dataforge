@echo off
setlocal EnableExtensions EnableDelayedExpansion
title DataForge Setup

set "ROOT=%~dp0"
cd /d "%ROOT%"
set "PY_VER=3.12.6"
set "NODE_VER=20.19.0"
set "PY_DIR=%ROOT%.python"
set "NODE_DIR=%ROOT%.node"
set "PY_EXE=%PY_DIR%\python.exe"
set "NPM_CMD=%NODE_DIR%\npm.cmd"
set "NODE_STAMP_FILE=%NODE_DIR%\setup-node-version.txt"

echo ================================================
echo DataForge Windows Self-Contained Setup
echo This will download Python %PY_VER% and Node %NODE_VER%
echo No global Python or Node/npm required on this machine
echo Then create venv and install all deps.
echo ================================================
echo.

:: Download and install Python if not present
if not exist "%PY_EXE%" (
    echo Downloading Python %PY_VER% installer...
    powershell -NoProfile -Command ^
        "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/%PY_VER%/python-%PY_VER%-amd64.exe' -OutFile '%ROOT%python-installer.exe' -UseBasicParsing"
    if errorlevel 1 (
        echo [ERROR] Failed to download Python.
        pause
        exit /b 1
    )

    echo Installing Python %PY_VER% to %PY_DIR% - per-user, no PATH pollution...
    start /wait "" "%ROOT%python-installer.exe" /quiet /install TargetDir="%PY_DIR%" InstallAllUsers=0 PrependPath=0 Include_pip=1 Include_tcltk=0 Include_test=0 Include_launcher=0
    del "%ROOT%python-installer.exe" >nul 2>&1

    if not exist "%PY_EXE%" (
        echo [ERROR] Python installation failed or python.exe not found at %PY_EXE%.
        echo Try running the installer manually or check permissions.
        pause
        exit /b 1
    )
    echo Python installed successfully.
) else (
    echo Python already present at %PY_DIR%.
)

:: Download and extract Node if missing or outdated
set "INSTALL_NODE=1"
if exist "%NPM_CMD%" if exist "%NODE_STAMP_FILE%" (
    set /p NODE_STAMPED=<"%NODE_STAMP_FILE%"
    if "!NODE_STAMPED!"=="%NODE_VER%" set "INSTALL_NODE=0"
)

if "!INSTALL_NODE!"=="1" (
    if exist "%NODE_DIR%" (
        echo Upgrading Node.js to %NODE_VER%...
        rmdir /s /q "%NODE_DIR%"
    ) else (
        echo Downloading Node.js %NODE_VER% portable zip...
    )
    powershell -NoProfile -Command ^
        "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v%NODE_VER%/node-v%NODE_VER%-win-x64.zip' -OutFile '%ROOT%node.zip' -UseBasicParsing"
    if errorlevel 1 (
        echo [ERROR] Failed to download Node.js.
        pause
        exit /b 1
    )

    echo Extracting Node to %NODE_DIR%...
    powershell -NoProfile -Command ^
        "Expand-Archive -Path '%ROOT%node.zip' -DestinationPath '%NODE_DIR%' -Force; " ^
        "Move-Item -Path '%NODE_DIR%\node-v%NODE_VER%-win-x64\*' -Destination '%NODE_DIR%' -Force; " ^
        "Remove-Item -Path '%NODE_DIR%\node-v%NODE_VER%-win-x64' -Recurse -Force"
    del "%ROOT%node.zip" >nul 2>&1

    if not exist "%NPM_CMD%" (
        echo [ERROR] Node/npm setup failed.
        pause
        exit /b 1
    )
    >"%NODE_STAMP_FILE%" echo %NODE_VER%
    echo Node.js %NODE_VER% installed successfully.
) else (
    echo Node.js %NODE_VER% already present at %NODE_DIR%.
)

echo.
echo Creating backend venv using the downloaded Python, if not already present...
if not exist "%ROOT%backend\.venv\Scripts\python.exe" (
    "%PY_EXE%" -m venv "%ROOT%backend\.venv"
    if errorlevel 1 (
        echo [ERROR] Failed to create venv.
        pause
        exit /b 1
    )
)

set "VENV_PY=%ROOT%backend\.venv\Scripts\python.exe"

echo Upgrading pip and installing backend dependencies...
"%VENV_PY%" -m pip install --upgrade pip
"%VENV_PY%" -m pip install -r "%ROOT%backend\requirements.txt" -r "%ROOT%backend\requirements-dev.txt"
if errorlevel 1 (
    echo [ERROR] Backend dependency installation failed.
    pause
    exit /b 1
)

:: Dates the install so start.ps1 can warn when requirements.txt has moved on.
>"%ROOT%backend\.venv\.dataforge-deps-stamp" echo %DATE% %TIME%

echo.
echo Installing frontend dependencies using the downloaded npm...
pushd "%ROOT%frontend"
call "%NPM_CMD%" install
if errorlevel 1 (
    popd
    echo [ERROR] Frontend npm install failed.
    pause
    exit /b 1
)
popd

echo.
echo ================================================
echo Setup complete^!
echo You can now run start.bat or start.ps1 from this folder.
echo Everything - Python, Node, venvs, deps - is local to this project.
echo No global Python or Node installation was required or modified.
echo ================================================
echo.
echo Press any key to close this window...
pause >nul
exit /b 0