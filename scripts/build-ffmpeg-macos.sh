#!/usr/bin/env bash
# Builds FFmpeg + FFprobe natively on macOS from official source and places them
# where Tauri expects sidecar binaries (src-tauri/binaries/<name>-<target-triple>).
#
# Why build from source instead of downloading a prebuilt binary?
#  - We can pin the exact source commit and publish it (GPL source-offer duty).
#  - We can guarantee the binary is NOT --enable-nonfree (which is not
#    redistributable) and links only against macOS system libraries.
#  - It is a native arm64 / x86_64 binary (no Rosetta needed).
#
# The result is a GPL build (x264 is GPL). ClipForge runs it as a separate
# process; see src-tauri/resources/THIRD_PARTY_NOTICES.md.
set -euo pipefail

FFMPEG_TAG="n7.1.1"
FFMPEG_COMMIT="db69d06eeeab4f46da15030a80d539efb4503ca8"
X264_REPO="https://code.videolan.org/videolan/x264.git"
X264_BRANCH="stable"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${FFBUILD_WORK:-$ROOT/.cache/ffbuild}"
OUT="$ROOT/src-tauri/binaries"
LIC="$ROOT/src-tauri/resources/licenses"
export MACOSX_DEPLOYMENT_TARGET="11.0"

[ "$(uname -s)" = "Darwin" ] || { echo "This script must run on macOS." >&2; exit 1; }
case "$(uname -m)" in
  arm64)  TRIPLE="aarch64-apple-darwin"; ARCH="arm64" ;;
  x86_64) TRIPLE="x86_64-apple-darwin";  ARCH="x86_64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
JOBS="$(sysctl -n hw.ncpu)"

if [ -x "$OUT/ffmpeg-$TRIPLE" ] && [ -x "$OUT/ffprobe-$TRIPLE" ] && [ -f "$LIC/BUILD-INFO.txt" ] && [ "${1:-}" != "--force" ]; then
  echo "FFmpeg for $TRIPLE already built; skipping (use --force to rebuild)."
  exit 0
fi

echo "==> Building FFmpeg $FFMPEG_TAG + x264 for $TRIPLE with $JOBS jobs"
PREFIX="$WORK/prefix-$ARCH"
mkdir -p "$WORK" "$PREFIX" "$OUT" "$LIC"
cd "$WORK"

# ---- x264 (H.264 encoder) ---------------------------------------------------
if [ ! -d x264 ]; then
  git clone --depth 1 --branch "$X264_BRANCH" "$X264_REPO" x264
fi
X264_COMMIT="$(git -C x264 rev-parse HEAD)"
echo "==> x264 commit: $X264_COMMIT"
(
  cd x264
  make distclean >/dev/null 2>&1 || true
  ./configure --prefix="$PREFIX" --enable-static --disable-cli --disable-opencl --enable-pic --bit-depth=8
  make -j"$JOBS"
  make install
)

# ---- FFmpeg -----------------------------------------------------------------
if [ ! -d ffmpeg ]; then
  git clone --depth 1 --branch "$FFMPEG_TAG" https://github.com/FFmpeg/FFmpeg.git ffmpeg
fi
ACTUAL="$(git -C ffmpeg rev-parse HEAD)"
if [ "$ACTUAL" != "$FFMPEG_COMMIT" ]; then
  echo "FFmpeg commit mismatch: expected $FFMPEG_COMMIT, got $ACTUAL" >&2
  exit 1
fi

(
  cd ffmpeg
  make distclean >/dev/null 2>&1 || true
  PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" ./configure \
    --prefix="$PREFIX/ffmpeg-install" \
    --pkg-config-flags=--static \
    --extra-cflags="-I$PREFIX/include" \
    --extra-ldflags="-L$PREFIX/lib" \
    --disable-autodetect \
    --disable-debug --disable-doc --disable-ffplay --disable-network \
    --disable-shared --enable-static \
    --enable-gpl --enable-libx264 \
    --enable-videotoolbox --enable-audiotoolbox \
    --enable-zlib --enable-iconv --enable-bzlib
  make -j"$JOBS"
)

cp ffmpeg/ffmpeg  "$OUT/ffmpeg-$TRIPLE"
cp ffmpeg/ffprobe "$OUT/ffprobe-$TRIPLE"
chmod +x "$OUT/ffmpeg-$TRIPLE" "$OUT/ffprobe-$TRIPLE"
strip -x "$OUT/ffmpeg-$TRIPLE" "$OUT/ffprobe-$TRIPLE"
codesign --force --sign - "$OUT/ffmpeg-$TRIPLE" "$OUT/ffprobe-$TRIPLE"

# ---- Verification: fail the build rather than ship a bad binary -------------
for tool in ffmpeg ffprobe; do
  bin="$OUT/$tool-$TRIPLE"
  archs="$(lipo -archs "$bin")"
  [ "$archs" = "$ARCH" ] || { echo "$tool is '$archs', expected '$ARCH'" >&2; exit 1; }

  # Only macOS system libraries/frameworks may be linked dynamically.
  bad="$(otool -L "$bin" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/)' || true)"
  if [ -n "$bad" ]; then
    echo "$tool links non-system libraries:" >&2
    echo "$bad" >&2
    exit 1
  fi
done

VERSION_TEXT="$("$OUT/ffmpeg-$TRIPLE" -hide_banner -version)"
ENCODERS_TEXT="$("$OUT/ffmpeg-$TRIPLE" -hide_banner -encoders)"
head -3 <<<"$VERSION_TEXT"
# Here-strings (not pipes) so `grep -q` exiting early can't cause a SIGPIPE failure.
grep -q -- '--enable-gpl'     <<<"$VERSION_TEXT" || { echo "expected a GPL build" >&2; exit 1; }
grep -q -- '--enable-libx264' <<<"$VERSION_TEXT" || { echo "libx264 missing" >&2; exit 1; }
if grep -q -- '--enable-nonfree' <<<"$VERSION_TEXT"; then
  echo "FFmpeg was built with --enable-nonfree; that binary cannot be redistributed." >&2
  exit 1
fi
grep -q ' libx264 ' <<<"$ENCODERS_TEXT" || { echo "libx264 encoder not available" >&2; exit 1; }
grep -q ' aac '     <<<"$ENCODERS_TEXT" || { echo "aac encoder not available" >&2; exit 1; }
"$OUT/ffprobe-$TRIPLE" -hide_banner -version >/dev/null

# ---- License texts + exact source information (shipped inside the app) ------
cp ffmpeg/COPYING.GPLv2 "$LIC/FFMPEG-COPYING.GPLv2"
cp ffmpeg/COPYING.GPLv3 "$LIC/FFMPEG-COPYING.GPLv3"
cp ffmpeg/LICENSE.md    "$LIC/FFMPEG-LICENSE.md"
cp x264/COPYING         "$LIC/X264-COPYING"
{
  echo "ClipForge bundled FFmpeg build ($TRIPLE)"
  echo
  echo "FFmpeg $FFMPEG_TAG"
  echo "  source : https://github.com/FFmpeg/FFmpeg/tree/$FFMPEG_COMMIT"
  echo "  tarball: https://github.com/FFmpeg/FFmpeg/archive/$FFMPEG_COMMIT.tar.gz"
  echo "x264 (branch $X264_BRANCH)"
  echo "  source : https://code.videolan.org/videolan/x264/-/tree/$X264_COMMIT"
  echo
  echo "Configuration:"
  grep '^configuration:' <<<"$VERSION_TEXT" || true
  echo
  echo "Both are licensed under the GNU GPL. ClipForge runs these as separate programs."
} > "$LIC/BUILD-INFO.txt"

echo "==> Done: $OUT/ffmpeg-$TRIPLE ($(du -h "$OUT/ffmpeg-$TRIPLE" | cut -f1)), ffprobe ($(du -h "$OUT/ffprobe-$TRIPLE" | cut -f1))"
