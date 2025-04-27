
# Blonel Two-Way Video Call Webapp


Install packages and run:
* npm i
* npm run start

Visit http://localhost:3000 for demo.

## Project Structure

blonel/
├── public/
│   ├── index.html
│   ├── client.js
│   ├── webrtc.js
│   ├── client.js
│   ├── ui.css
├── app.js
├── server.js
└── package.json


## Old Project Structure

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