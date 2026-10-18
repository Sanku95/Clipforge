#!/usr/bin/env bash
# Verify the built DMG the way a user would receive it.
#   usage: ci-verify-macos.sh <expected-lipo-arch: arm64|x86_64> <artifact-arch-name>
# Writes app= and exe= to $GITHUB_OUTPUT (if set) and copies the DMG + checksum to ./dist.
set -euo pipefail
EXPECT_ARCH="$1"
NAME="$2"

DMG="$(ls target/release/bundle/dmg/*.dmg | head -1)"
echo "DMG: $DMG"; ls -lh "$DMG"
hdiutil verify "$DMG"

MNT="$(mktemp -d)"
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MNT"
trap 'hdiutil detach "$MNT" -force >/dev/null 2>&1 || true' EXIT
echo "--- DMG contents"; ls -la "$MNT"
test -d "$MNT/ClipForge.app" || { echo "ClipForge.app is not inside the DMG"; exit 1; }

# Simulate installation: copy the app out of the DMG.
INSTALL="$(mktemp -d)"
ditto "$MNT/ClipForge.app" "$INSTALL/ClipForge.app"
APP="$INSTALL/ClipForge.app"
EXE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
echo "executable: $EXE"
if [ -n "${GITHUB_OUTPUT:-}" ]; then { echo "exe=$EXE"; echo "app=$APP"; } >> "$GITHUB_OUTPUT"; fi

echo "--- bundle layout"
find "$APP/Contents" -maxdepth 3 -not -path '*/_CodeSignature/*' | sort | head -60
for f in "MacOS/$EXE" "MacOS/ffmpeg" "MacOS/ffprobe" "Resources/THIRD_PARTY_NOTICES.md" "Resources/licenses/BUILD-INFO.txt" "Resources/icon.icns"; do
  test -e "$APP/Contents/$f" || { echo "MISSING in app: $f"; exit 1; }
  echo "ok  $f"
done

echo "--- architectures (expect $EXPECT_ARCH)"
for f in "$EXE" ffmpeg ffprobe; do
  archs="$(lipo -archs "$APP/Contents/MacOS/$f")"
  echo "$f: $archs"
  [ "$archs" = "$EXPECT_ARCH" ] || { echo "wrong architecture for $f"; exit 1; }
done

echo "--- code signature"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dv "$APP" 2>&1 | grep -E "Signature|Identifier|TeamIdentifier" || true

echo "--- self-test of the INSTALLED app (bundled ffmpeg, all presets)"
"$APP/Contents/MacOS/$EXE" --selftest

mkdir -p dist
cp "$DMG" "dist/ClipForge_${NAME}.dmg"
(cd dist && shasum -a 256 "ClipForge_${NAME}.dmg" > "ClipForge_${NAME}.dmg.sha256" && cat "ClipForge_${NAME}.dmg.sha256")
