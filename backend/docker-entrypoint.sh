#!/bin/sh
set -e

if [ "$(id -u)" = "0" ]; then
    target_uid="${AURRAL_UID:-${PUID:-}}"
    target_gid="${AURRAL_GID:-${PGID:-}}"

    default_uid="$(awk -F: '$1=="nodejs"{print $3; exit}' /etc/passwd)"
    default_gid="$(awk -F: '$1=="nodejs"{print $4; exit}' /etc/group)"

    if [ -z "$default_uid" ]; then
        default_uid="1001"
    fi
    if [ -z "$default_gid" ]; then
        default_gid="1001"
    fi

    if [ -z "$target_uid" ]; then
        target_uid="$default_uid"
    fi
    if [ -z "$target_gid" ]; then
        target_gid="$default_gid"
    fi

    target_group="$(awk -F: -v gid="$target_gid" '$3==gid{print $1; exit}' /etc/group)"
    if [ -z "$target_group" ]; then
        groupadd -g "$target_gid" aurral
        target_group="aurral"
    fi

    target_user="$(awk -F: -v uid="$target_uid" '$3==uid{print $1; exit}' /etc/passwd)"
    if [ -z "$target_user" ]; then
        useradd -u "$target_uid" -g "$target_group" -M -s /usr/sbin/nologin aurral
        target_user="aurral"
    fi

    mkdir -p /app/backend/data
    chown -R "$target_uid:$target_gid" /app/backend/data

    exec gosu "$target_uid:$target_gid" "$@"
fi

exec "$@"
