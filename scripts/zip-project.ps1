# ============================================================
#  BrewLite - Auto zip du an (bo node_modules, build, .git...)
#  Bao gom day du source code sach va cac file .env*
# ============================================================

# Tat progress bar: tranh crash tien trinh khi chay khong co console day du
$ProgressPreference = 'SilentlyContinue'

# Thu muc goc du an = thu muc cha cua scripts\
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectName = Split-Path $root -Leaf
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$outDir = Join-Path $root 'outputs'
if (-not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}
$zip = Join-Path $outDir "$projectName-$stamp.zip"

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host " [BrewLite] DONG GOI DU AN (ZIP PROJECT)" -ForegroundColor Cyan
Write-Host " Thu muc goc : $root"
Write-Host " File zip    : $zip"
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''

# Thu muc loai bo (khop o bat ky cap nao) - cat nhanh truoc khi di vao
$excludeDirs = @(
    'node_modules',
    '.git',
    '.worktrees',
    '.tmp',
    'tmp',
    '.next',
    'dist',
    'build',
    'out',
    'coverage',
    '.pnpm-store',
    '.turbo',
    'playwright-report',
    'test-results',
    'blob-report',
    '.cache',
    '.swc',
    'outputs',
    '.idea',
    '.vscode',
    '.agents',
    '__MACOSX',
    'tham_khao'
)

# File loai bo theo pattern
$excludeFiles = @(
    '*.log',
    'npm-debug.log*',
    'yarn-debug.log*',
    'pnpm-debug.log*',
    '*.tsbuildinfo',
    '*.db',
    '*.db-journal',
    '*.sqlite',
    '*.sqlite-journal',
    '.DS_Store',
    'Thumbs.db',
    '*.zip',
    '*.7z',
    '*.rar',
    '*.tar.gz',
    '*.bak',
    '*.swp',
    '*~',
    '*.aux',
    '*.fls',
    '*.fdb_latexmk',
    '*.synctex.gz',
    '.eslintcache'
)

Write-Host ' [1/3] Dang quet file sach (bo node_modules, .worktrees, cache, build)...' -ForegroundColor Yellow

# Duyet thu cong theo kieu prune: khong di vao $excludeDirs
$files = New-Object System.Collections.Generic.List[string]
$stack = New-Object System.Collections.Generic.Stack[string]
$stack.Push($root)

$envFilesFound = New-Object System.Collections.Generic.List[string]

while ($stack.Count -gt 0) {
    $dir = $stack.Pop()
    $children = Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue
    foreach ($c in $children) {
        if ($c.PSIsContainer) {
            if ($excludeDirs -contains $c.Name) { continue }
            # Bo qua reparse point (symlink/junction) de tranh vong lap
            if ($c.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            $stack.Push($c.FullName)
        }
        else {
            $name = $c.Name

            # Kiem tra file .env (luon giu lai theo yeu cau nguoi dung)
            $isEnv = ($name -eq '.env' -or $name -like '.env.*')

            if ($isEnv) {
                $files.Add($c.FullName)
                $rel = $c.FullName.Substring($root.Length).TrimStart('\')
                $envFilesFound.Add($rel)
                continue
            }

            # Kiem tra file rac can loai bo
            $skip = $false
            foreach ($pat in $excludeFiles) {
                if ($name -like $pat) {
                    $skip = $true
                    break
                }
            }

            if (-not $skip) {
                $files.Add($c.FullName)
            }
        }
    }
}

Write-Host ("       Tong so file hop le: " + $files.Count) -ForegroundColor Green
if ($envFilesFound.Count -gt 0) {
    Write-Host ("       Cac file .env duoc dong goi (" + $envFilesFound.Count + "):") -ForegroundColor Green
    foreach ($ef in $envFilesFound) {
        Write-Host "         + $ef" -ForegroundColor DarkGreen
    }
}

if ($files.Count -eq 0) {
    Write-Host ' [LOI] Khong tim thay file nao de dong goi.' -ForegroundColor Red
    exit 1
}

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }

Write-Host ''
Write-Host ' [2/3] Dang nen file zip bang .NET Compression (Optimal)...' -ForegroundColor Yellow

# Nen truc tiep bang .NET ZipFile - khong can copy sang thu muc tam
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $rootPrefixLen = $root.Length
    $total = $files.Count
    foreach ($full in $files) {
        # Duong dan tuong doi trong zip, dung dau '/'
        $entryName = $full.Substring($rootPrefixLen).TrimStart('\').Replace('\', '/')
        try {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $full, $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
        catch {
            Write-Host ("  [BO QUA] Khong doc duoc: " + $entryName) -ForegroundColor DarkYellow
        }
    }
}
finally {
    $archive.Dispose()
}

$zipItem = Get-Item -LiteralPath $zip
$sizeMB = [math]::Round($zipItem.Length / 1MB, 2)
$sizeKB = [math]::Round($zipItem.Length / 1KB, 0)

Write-Host ''
Write-Host ' [3/3] HOAN TAT!' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host " Dong goi thanh cong!" -ForegroundColor Green
Write-Host " Tong so file : $total"
Write-Host " Kich thuoc   : $sizeMB MB ($sizeKB KB)"
Write-Host " Thu muc chua : $outDir"
Write-Host " File zip     : $zip"
Write-Host '============================================================' -ForegroundColor Cyan
