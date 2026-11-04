# OpenMTP Enhanced 3.3.1-enhanced.5

Apple Silicon preview derived from https://github.com/ganeshrvel/openmtp (MIT).
Recovered from upstream source and the installed preview 3 source maps after the
previous working directory was deleted. The project is in Downloads as requested.

## Missed Samsung authorization prompt

If the first phone prompt is dismissed, click **Refresh** in the Android pane.
The app first reconnects normally. Only if the selected phone still returns no
storage, it uses that phone's already-authorized wired ADB serial to briefly turn
MTP off and back on, then waits up to 60 seconds for the phone's manual permission.
The phone must remain unlocked and the user must tap **Allow**. No permission is
accepted automatically. ADB authorization and persistent USB defaults are not changed.
ADB transport briefly disconnects during USB reconfiguration. Recovery never runs
while transferring and does not loop automatically if the prompt is dismissed again.
Reconnection is matched by serial, vendor and product, even if its USB address changes.
ADB must already be installed; common Homebrew, Android SDK and ~/.local/bin paths
are supported. No recovery is attempted against an unauthorized or wireless target.

## Other preserved fixes

- Correct UTF-16 encoding/decoding of emoji and supplementary CJK characters.
- Select one connected Android device; switching clears stale selections and clipboard.
- Preserve POSIX colons (shown as slashes in Finder), backslashes and other legal names
  in Kalam mode instead of rejecting the entire transfer path. Literal slash and NUL
  remain invalid filename components. Device filesystems may impose further limits.
- Preserve the user's custom icon as the bundled `build/icon.icns`.

## Build and validate

Requirements: Apple Silicon macOS, Node, Yarn classic, Go and Homebrew libusb.

```sh
yarn install --ignore-scripts --ignore-engines
./scripts/build-enhanced-native.sh
node tests/mtp-access-recovery.cjs
node tests/mtp-recovery-gate.cjs
NODE_OPTIONS=--openssl-legacy-provider yarn build-no-verify
node scripts/package-installed-runtime.cjs
```

The packaging helper reuses the existing installed Enhanced Electron 18 runtime
and production dependencies. The application is ad-hoc signed and not notarized.
Native go-mtpfs source is based on upstream commit 1c3302b3c476; its license is included.
Recovery tests verify exact device targeting, transport disconnect handling,
restoration after failure, one recovery attempt per refresh, and USB address rebinding.

Samsung may re-enumerate USB again when Allow is tapped. Permission polling rebinds
the same serial without restarting the authorization request.

## Validation on the connected Samsung

The owner dismissed the initial phone prompt. An MTP off/on cycle requested a new
prompt without unplugging; after manual Allow, the native layer exposed one
internal storage and the installed GUI loaded 54 root entries. Rebinding an
expired USB address to the same serial was verified against the physical phone.
Simultaneous two-phone transfer and the reported large-file transfer remain
unverified. Unit tests cover the recovery and device-selection gates.

Prebuilt Apple Silicon Kalam dylibs/headers are included alongside their Go source.
Run `yarn build:native` to rebuild them before packaging after native source changes.

## Preview 5 toolbar layout

The device picker is an exchange-arrow icon in the existing Android toolbar,
between Delete and Storage. Its tooltip and accessible name identify device
switching. Recovery and error messages use a transient notification rather than
adding another toolbar row.
