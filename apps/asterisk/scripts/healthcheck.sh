#!/bin/sh
set -eu
asterisk -rx "core show version" >/dev/null
asterisk -rx "module show like chan_websocket.so" | grep -q "Running"
asterisk -rx "module show like chan_pjsip.so" | grep -q "Running"
asterisk -rx "http show status" | grep -q "Enabled and Bound"
