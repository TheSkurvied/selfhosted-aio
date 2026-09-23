#!/bin/sh
set -e
# adapter-node checks form-post origins against ORIGIN; default it to PUBLIC_URL.
if [ -z "$ORIGIN" ] && [ -n "$PUBLIC_URL" ]; then
	export ORIGIN="$PUBLIC_URL"
fi
exec "$@"
