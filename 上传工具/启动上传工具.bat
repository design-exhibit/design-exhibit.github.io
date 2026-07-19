@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHON="

for /f "delims=" %%P in ('where python.exe 2^>nul') do (
    set "PYTHON=%%P"
    goto python_found
)

:python_found
if not defined PYTHON goto no_python

"%PYTHON%" -c "import tkinter, sys; sys.path.insert(0, sys.argv[1]); import upload_gui" "%~dp0." >nul 2>nul
if errorlevel 1 goto dependency_error

for %%P in ("%PYTHON%") do set "PYTHONW=%%~dpPpythonw.exe"
if exist "%PYTHONW%" (
    start "" "%PYTHONW%" "%~dp0upload_gui.py"
) else (
    start "" "%PYTHON%" "%~dp0upload_gui.py"
)
exit /b 0

:dependency_error
echo 上传工具启动失败，当前 Python 环境缺少所需组件：
"%PYTHON%" -c "import tkinter, sys; sys.path.insert(0, sys.argv[1]); import upload_gui" "%~dp0."
pause
exit /b 1

:no_python
echo 没有找到 Python，请先安装 Python 3。
pause
exit /b 1
