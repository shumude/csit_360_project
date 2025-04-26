
# Blonel Two-Way Video Call Webapp

Install GStreamer:
* macOS: brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly
* Linux: sudo apt-get install gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly
* Windows: Download from [GStreamer website](https://gstreamer.freedesktop.org/download/) and add to PATH.

Install packages and run:
* npm i
* npm run start

Visit http://localhost:3000 for demo.


## Project Structure

blonel/
├── public/
│   ├── index.html
│   ├── client.js
│   ├── hls.min.js
│   └── hls/
│       ├── client-<clientId>
│       │   ├── playlist.m3u8
│       │   └── (associated .webm segments)
├── server.js
└── package.json