package main

import (
	"testing"
	"time"
)

func TestStorageEnumerationDoesNotDeadlock(t *testing.T) {
	done := make(chan bool)
	go func() { FetchStorages(nil); done <- true }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("recursive native session lock")
	}
}
