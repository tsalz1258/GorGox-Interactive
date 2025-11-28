@echo off
echo ========================================
echo   FORCE CLEAR BROWSER CACHE
echo ========================================
echo.
echo This will help fix issues where the browser
echo shows old content even in incognito mode.
echo.
echo INSTRUCTIONS:
echo ========================================
echo.
echo 1. CLOSE ALL BROWSERS COMPLETELY
echo    - Chrome, Edge, Firefox - close everything
echo.
echo 2. CLEAR DNS CACHE (run this):
echo.

ipconfig /flushdns

echo.
echo 3. Now open browser and try ONE of these:
echo.
echo    METHOD A - Incognito + Hard Refresh:
echo    ------------------------------------
echo    - Open Incognito (Ctrl + Shift + N)
echo    - Go to: http://localhost:3000
echo    - Press: Ctrl + Shift + R (hard refresh)
echo    - Press F12, go to Network tab
echo    - Check "Disable cache" checkbox
echo    - Refresh again (Ctrl + Shift + R)
echo.
echo    METHOD B - Clear All Cache:
echo    ---------------------------
echo    - Open regular browser
echo    - Press: Ctrl + Shift + Delete
echo    - Select "All time"
echo    - Check "Cached images and files"
echo    - Click "Clear data"
echo    - Then use Incognito
echo.
echo    METHOD C - Different Browser:
echo    -----------------------------
echo    - Try Firefox if using Chrome
echo    - Try Chrome if using Firefox
echo    - Fresh incognito window
echo.
echo ========================================
echo DNS cache has been flushed!
echo Now follow the methods above.
echo ========================================
pause









