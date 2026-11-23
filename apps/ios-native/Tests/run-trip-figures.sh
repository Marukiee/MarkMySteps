#!/bin/sh
# Compiles TripFigures.swift with its checks and runs them; no Xcode project, no simulator.
set -e
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/mms-trip-figures"
swiftc -o "$out" MarkMySteps/TripFigures.swift Tests/TripFigures/main.swift
"$out"
