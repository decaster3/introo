#!/bin/sh
# Substitute only PORT variable, preserve nginx variables like $uri
envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
