package mtp

import (
	"bytes"
	"strings"
	"testing"
)

func TestUnicodeFilenameRoundtrip(t *testing.T) {
	for _, name := range []string{"中文📷.bin", "𠮷野家.txt", "Finder slash: example.bin", "a\\b % # &.txt"} {
		data, err := encodeStr(nil, name)
		if err != nil {
			t.Fatal(err)
		}
		got, err := decodeStr(bytes.NewReader(data))
		if err != nil || got != name {
			t.Fatalf("%q != %q: %v", got, name, err)
		}
	}
	if _, err := encodeStr(nil, strings.Repeat("📷", 128)); err == nil {
		t.Fatal("UTF-16 length overflow accepted")
	}
	if _, err := decodeStr(bytes.NewReader([]byte{2, 65})); err == nil {
		t.Fatal("truncated input accepted")
	}
}
