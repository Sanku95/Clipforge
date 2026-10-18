# Third-party notices

ClipForge processes video with **FFmpeg** and **FFprobe**, which are bundled inside this app
(`ClipForge.app/Contents/MacOS/ffmpeg` and `ffprobe`) and run as separate programs.

- FFmpeg is licensed under the GNU General Public License (this build includes GPL components).
- The H.264 encoder is **x264**, licensed under the GNU General Public License.
- Full license texts are in `licenses/` next to this file.
- `licenses/BUILD-INFO.txt` names the exact source versions and the build configuration that
  produced the bundled binaries. The corresponding source code is available at the URLs listed
  there, and ClipForge's build script (`scripts/build-ffmpeg-macos.sh`) reproduces the build.

ClipForge itself is not a derivative of FFmpeg or x264: it launches them as external programs.

H.264 and AAC are patent-encumbered formats. Whether you need a patent license for your own
distribution of exported video depends on your use; this notice is not legal advice.
