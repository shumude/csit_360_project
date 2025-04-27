
# Blonel Two-Way Video Call Webapp

Install FFmpeg on the server:
* macOS: brew install ffmpeg
* Linux: sudo apt-get install ffmpeg
* Windows: Download from [FFmpeg website](https://ffmpeg.org/download.html) and add to PATH.

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