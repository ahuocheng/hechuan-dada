#!/usr/bin/env bash
# 准备语音识别模型（约 230 MB，太大放不进 git）：
# 从已经发布的 Windows 安装包里把 resources/models 原样取出来，保证 Mac 版和 Windows 版识别效果一模一样。
# 需要 7-Zip：Mac 上 `brew install sevenzip`，Ubuntu 上 `apt install p7zip-full`
set -euo pipefail

VERSION="${MODELS_FROM_VERSION:-1.3.1}"
URL="https://github.com/ahuocheng/hechuan-dada/releases/download/v${VERSION}/campus-assistant-setup-${VERSION}.exe"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/models"

check() {
  (cd "$OUT" && shasum -a 256 -c - >/dev/null 2>&1) <<'SUMS'
9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6  silero_vad.onnx
12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d  sensevoice/model.int8.onnx
f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc  sensevoice/tokens.txt
SUMS
}

if [ -d "$OUT" ] && check; then echo "models 已经准备好了：$OUT"; exit 0; fi

SZ="$(command -v 7zz || command -v 7z || true)"
[ -n "$SZ" ] || { echo "找不到 7-Zip（7zz / 7z），先装一下：brew install sevenzip" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "下载 $URL"
curl -fL --retry 4 -o "$TMP/setup.exe" "$URL"
"$SZ" x -y -o"$TMP/nsis" "$TMP/setup.exe" '$PLUGINSDIR/app-64.7z' >/dev/null
"$SZ" x -y -o"$TMP/app" "$TMP/nsis/\$PLUGINSDIR/app-64.7z" 'resources/models' >/dev/null
rm -rf "$OUT"
mv "$TMP/app/resources/models" "$OUT"
check || { echo "模型文件校验不对" >&2; exit 1; }
echo "models 已经准备好了：$OUT"
