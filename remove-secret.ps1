# Script to remove FIX_SECRET.md from all git history

Write-Host "This script will remove FIX_SECRET.md from all git history" -ForegroundColor Yellow
Write-Host "This is a destructive operation. Make sure you have a backup!" -ForegroundColor Red
Write-Host ""
Write-Host "Steps:"
Write-Host "1. Delete FIX_SECRET.md from all commits using git filter-branch"
Write-Host "2. Force push to update remote"
Write-Host ""

$confirm = Read-Host "Continue? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit
}

Write-Host "Removing FIX_SECRET.md from all commits..." -ForegroundColor Green

# Remove the file from all commits
git filter-branch --force --index-filter `
    "git rm --cached --ignore-unmatch FIX_SECRET.md" `
    --prune-empty --tag-name-filter cat -- --all

Write-Host ""
Write-Host "Done! Now you need to force push:" -ForegroundColor Green
Write-Host "  git push --force --all" -ForegroundColor Cyan
Write-Host "  git push --force --tags" -ForegroundColor Cyan




