Write-Host "=== Quantum Council Secret Setup ===" -ForegroundColor Cyan
Write-Host "Enter each value and press Enter. Same key for all is fine." -ForegroundColor Gray
Write-Host ""
$names = @("QUANTUM_AUTH_TOKEN","KEY_ARCHITECT","KEY_VISIONARY","KEY_STRATEGIST","KEY_EMOTIONAL","KEY_ENERGY","KEY_QUESTIONER","KEY_HISTORIAN","KEY_LANGUAGE","KEY_CONNECTOR","KEY_COMMANDER","KEY_AMPLIFIER","KEY_OBSERVER")
foreach ($n in $names) {
  Write-Host "--- $n" -ForegroundColor Yellow
  $v = Read-Host "  Value"
  if ($v.Trim() -ne "") { $v | npx wrangler secret put $n }
  Write-Host ""
}
Write-Host "Done!" -ForegroundColor Green
