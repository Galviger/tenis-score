# Tennis Scoreboard

A simple real-time tennis tournament scoreboard built with Node.js and Socket.IO.

## Features

* Real-time score updates
* Three independent courts
* Court tablets for score entry
* Admin interface for match management
* Public display mode for spectators
* Match queue management
* Singles and doubles support
* Automatic device binding
* Local network operation without internet access

## Roles

### Court

* Updates match scores
* Changes match status
* Adds match notes

### Admin

* Assigns players to courts
* Manages match queues
* Starts the next match
* Resets courts
* Releases paired devices

### Display

* Shows all courts simultaneously
* Displays current matches and scores
* Displays the next match in queue

## Technology

* Node.js
* Express
* Socket.IO
* Vanilla JavaScript
* HTML/CSS

## Installation

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Notes

Add your own password in the "server.js" script on the line 335.
Add your own TOKEN and chatID for your Telegram bot in the "server.js" script on lines 180 and 181 respectively.

This project was developed for local tennis tournaments and is intended to run on a local network using tablets, phones, or Raspberry Pi devices.

Parts of the project were developed with the assistance of AI tools.
