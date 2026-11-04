#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PKG_CONFIG_PATH="$(brew --prefix libusb)/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
(cd ffi/kalam/native && go test ./... && go build -buildmode=c-shared -o ../../../build/mac/bin/arm64/kalam.dylib .)
bin=build/mac/bin/arm64
cp "$(brew --prefix libusb)/lib/libusb-1.0.0.dylib" "$bin/libusb.dylib"
install_name_tool -change "$(brew --prefix libusb)/lib/libusb-1.0.0.dylib" @loader_path/libusb.dylib "$bin/kalam.dylib"
cp "$bin/kalam.dylib" "$bin/kalam-seg5.dylib"
cp "$bin/kalam.h" "$bin/kalam-seg5.h"
codesign --force --sign - "$bin/kalam.dylib"
codesign --force --sign - "$bin/kalam-seg5.dylib"
