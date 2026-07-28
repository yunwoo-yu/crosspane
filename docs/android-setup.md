# Android pane setup

The Android pane needs a working Android SDK **with an emulator image**, or a
USB-connected device. This guide walks through a from-scratch setup and maps each
crosspane error message to its fix.

Already using Android Studio? You almost certainly have everything — crosspane
auto-detects the SDK and any existing AVD. This guide is for people setting up
without Android Studio.

## Where crosspane looks for the SDK

In order:

1. `$ANDROID_HOME`, then `$ANDROID_SDK_ROOT`
2. macOS: `~/Library/Android/sdk`, `/opt/homebrew/share/android-commandlinetools`
3. Windows: `%LOCALAPPDATA%\Android\Sdk`
4. Linux: `~/Android/Sdk`

If your SDK lives elsewhere, set `ANDROID_HOME`.

## From-scratch setup (macOS example)

```bash
# 1. Command-line tools (sdkmanager, avdmanager)
brew install --cask android-commandlinetools

# 2. Platform tools (adb), emulator, and a system image
sdkmanager "platform-tools" "emulator" "platforms;android-34" \
           "system-images;android-34;google_apis;arm64-v8a"
# Intel Macs / Windows / Linux: use x86_64 instead of arm64-v8a

# 3. Create an AVD (any name works — crosspane picks the first one)
avdmanager create avd -n crosspane -k "system-images;android-34;google_apis;arm64-v8a" \
           -d "pixel_7"

# 4. Done — crosspane boots it headless automatically
crosspane :3000 --android
```

On Windows/Linux, download the [command-line tools](https://developer.android.com/studio#command-line-tools-only),
unzip them into the SDK path above, and run the same `sdkmanager`/`avdmanager` steps.

A USB-connected phone (with USB debugging enabled) also works — no emulator or AVD
needed, crosspane uses the connected device directly.

## Error → fix

| crosspane says | Fix |
|---|---|
| `Android SDK not found` | Install the command-line tools (step 1) or point `ANDROID_HOME` at your SDK |
| `No connected Android device and no emulator installed` | `sdkmanager "emulator" "platform-tools"` (step 2) — the command-line tools cask alone does **not** include the emulator |
| `No Android AVD found` | Create one with `avdmanager` (step 3) |
| `Android emulator boot timed out` | First boot of a fresh AVD can be slow — run once manually (`emulator -avd crosspane`) to let it finish, then retry. Also check virtualization is available (no nested VM) |
| Korean/CJK typing does nothing | Expected on first run for a few seconds while the bundled IME installs; if it persists, check `adb devices` shows the device as `device` (not `unauthorized`) |

## Notes

- crosspane never shuts the emulator down — keeping it booted makes the next
  `crosspane` start near-instant.
- The page renders in a real **WebView shell app** (built automatically with the SDK's
  build-tools). If that build isn't possible (e.g. Windows), the pane falls back to
  Chrome — same engine, browser UI instead of the bare component.
- Touch input goes through the emulator's gRPC endpoint (port 8554). If another
  emulator instance occupies it, input falls back to slower adb injection.
