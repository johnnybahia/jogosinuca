@echo off
cls
echo ========================================================
echo    ATUALIZADOR AUTOMATICO - JOGO DE SINUCA 3D GITHUB
echo ========================================================
echo.

echo [1/3] Identificando novos arquivos e alteracoes...
git add .

echo [2/3] Salvando alteracoes localmente (Commit)...
git commit -m "Atualizacao automatica via script BAT"

echo [3/3] Enviando itens novos para o GitHub...
git push origin main

echo.
echo ========================================================
echo    PROCESSO CONCLUIDO! SEUS ITENS FORAM ENVIADOS.
echo ========================================================
pause