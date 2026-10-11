#!/bin/sh
# Pre-warm per-adapter dbt venvs at image build time (see
# src/lib/server/dbt-venvs.ts for the runtime side).
#
# Usage: dbt-venvs-warm.sh "duckdb,postgres,trino"
#
# The adapter set comes from the DBT_ADAPTERS build ARG (deployment config,
# not code). Each adapter gets an isolated venv with dbt-<adapter> installed,
# so dbt runs never depend on — or pollute — system Python. Failures are
# loud but non-fatal: boot reconciliation provisions at runtime instead.
set -eu

adapters="${1:-duckdb,postgres,trino}"
root="${DBT_VENVS_DIR:-/opt/dbt-venvs}"

mkdir -p "$root"

# POSIX-sh comma split (no bashisms — runner is bookworm-slim sh).
list="$(echo "$adapters" | tr ',' ' ')"
for raw in $list; do
	a="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
	if [ -z "$a" ]; then
		continue
	fi
	if [ -x "$root/$a/bin/dbt" ]; then
		echo "dbt venv for '$a' already present, skipping"
		continue
	fi
	echo "pre-warming dbt venv for adapter: $a"
	if python3 -m venv "$root/$a" \
		&& "$root/$a/bin/pip" install --quiet --upgrade pip \
		&& "$root/$a/bin/pip" install --quiet "dbt-$a"; then
		echo "dbt venv for '$a' ready"
	else
		echo "WARNING: pre-warm of dbt adapter '$a' failed; it will provision at container boot instead" >&2
		rm -rf "$root/$a"
	fi
done
