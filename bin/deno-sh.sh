#!/usr/bin/env bash

file=$(readlink -f $1)
deno_args="$(head -3 "$file" | grep 'deno-args:' | cut -d ':' -f2)"
#echo "deno-sh: running: 'deno run $deno_args $@'"
#echo "deno-sh: file: $file"

export DENO_ENTRY_SCRIPT="$file"
deno run $deno_args --allow-env "$@"
