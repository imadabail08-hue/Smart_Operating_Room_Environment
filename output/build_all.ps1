<#
.SYNOPSIS
  Compilation en un clic des livrables : diagrammes PNG, dossier PDF (Typst),
  dossier Word (Pandoc) et diaporama PowerPoint (Marp).

.PREREQUISITES (installation unique)
  npm install -g @mermaid-js/mermaid-cli @marp-team/marp-cli
  winget install --id Typst.Typst
  winget install --id JohnMacFarlane.Pandoc
  (fermer puis rouvrir PowerShell aprÃ¨s l'installation pour recharger le PATH)

.USAGE
  powershell -ExecutionPolicy Bypass -File .\output\build_all.ps1
#>

$ErrorActionPreference = 'Stop'

$Root  = Split-Path -Parent $PSScriptRoot
$Out   = Join-Path $Root 'output'
$Marp  = Join-Path $Root 'templates\marp\presentation_soutenance.md'
$Doc   = 'Dossier_Technique_General'

function Test-Tool([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Outil introuvable : '$name'. Voir la section PREREQUISITES de ce script."
  }
}
foreach ($t in 'mmdc', 'pandoc', 'typst', 'marp') { Test-Tool $t }

# 1. Diagrammes Mermaid -> PNG haute resolution (echelle x3, fond blanc)
Write-Host '[1/4] Diagrammes PNG (mmdc)...' -ForegroundColor Cyan
foreach ($d in 'bpmn_processus_medical', 'architecture_materielle') {
  mmdc -i "$Out\$d.mmd" -o "$Out\$d.png" -s 3 -b white
  if ($LASTEXITCODE -ne 0) { throw "mmdc a echoue sur $d.mmd" }
}

# 2. Dossier technique -> PDF via Typst (Markdown -> .typ -> PDF)
#    Execute depuis output\ pour que les images relatives (*.png) soient trouvees.
#    Verifier dans le PDF que la numerotation des chapitres n'est pas doublee.
Write-Host '[2/4] Dossier technique PDF (Pandoc + Typst)...' -ForegroundColor Cyan
Push-Location $Out
try {
  pandoc "$Doc.md" -f markdown -t typst -s --toc --resource-path="$Out" -o "$Doc.typ"
  if ($LASTEXITCODE -ne 0) { throw 'pandoc (Typst) a echoue' }
  typst compile "$Doc.typ" "$Doc.pdf"
  if ($LASTEXITCODE -ne 0) { throw 'typst compile a echoue' }

  # 3. Dossier technique -> Word editable (sommaire, numerotation, equations natives)
  Write-Host '[3/4] Dossier technique Word (Pandoc DOCX)...' -ForegroundColor Cyan
  pandoc "$Doc.md" -f markdown -o "$Doc.docx" --toc --toc-depth=3 --number-sections --resource-path="$Out"
  if ($LASTEXITCODE -ne 0) { throw 'pandoc (DOCX) a echoue' }
}
finally { Pop-Location }

# 4. Diaporama -> PowerPoint (images locales autorisees pour les diagrammes)
#    Par defaut, chaque diapositive est une image non modifiable.
#    Pour un PPTX editable (experimental, necessite LibreOffice) : ajouter --pptx-editable
Write-Host '[4/4] Diaporama PowerPoint (Marp)...' -ForegroundColor Cyan
marp "$Marp" --pptx --allow-local-files --no-stdin -o "$Out\presentation_soutenance.pptx"
if ($LASTEXITCODE -ne 0) { throw 'marp --pptx a echoue' }

Write-Host "`nLivrables generes dans $Out :" -ForegroundColor Green
Get-ChildItem $Out -Include *.png, *.pdf, *.docx, *.pptx -Recurse |
  Select-Object Name, @{ n = 'Ko'; e = { [math]::Round($_.Length / 1KB) } } |
  Format-Table -AutoSize
