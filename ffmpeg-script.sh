#!/bin/bash
mkdir -p public/dash
ffmpeg -i input.mp4 -c:v libx264 -c:a aac -f dash -hls_playlist 1 public/dash/output.mpd