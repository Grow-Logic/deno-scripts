#!/usr/bin/env bash

file="$1"
deno_args="$(head -3 "$file" | grep 'deno-args:' | cut -d ':' -f2)"
deno run $deno_args "$@"
