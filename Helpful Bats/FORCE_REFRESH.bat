@echo off
echo ========================================
echo   FORCE BROWSER CACHE REFRESH
echo ========================================
echo.
echo The "connect is not defined" error means your browser
echo is loading OLD JavaScript code from cache.
echo.
echo ========================================
echo   FIX: Hard Refresh Browser
echo ========================================
echo.
echo 1. Close ALL browser windows/tabs of localhost:3000
echo.
echo 2. Open a FRESH browser window (or use Incognito/Private mode)
echo.
echo 3. Go to: http://localhost:3000
echo.
echo 4. Press: Ctrl + Shift + R (or Ctrl + F5)
echo    This forces a hard refresh!
echo.
echo ========================================
echo   OR: Clear Browser Cache
echo ========================================
echo.
echo Chrome/Edge:
echo   - Press F12
echo   - Right-click the refresh button
echo   - Select "Empty Cache and Hard Reload"
echo.
echo Firefox:
echo   - Press Ctrl + Shift + Delete
echo   - Select "Cache" only
echo   - Click "Clear Now"
echo.
echo ========================================
echo   Best Practice: Use Incognito/Private
echo ========================================
echo.
echo Always test in Incognito/Private mode to avoid caching:
echo   Chrome: Ctrl + Shift + N
echo   Firefox: Ctrl + Shift + P
echo   Edge: Ctrl + Shift + N
echo.
echo This ensures you always get the latest code!
echo.
pause

