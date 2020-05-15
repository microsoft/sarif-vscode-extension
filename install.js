// F5 -> npm start -> npm prestart -> this script.
// Runs `npm install` only if needed. Otherwise skips (and saves time).

const fs = require('fs')
const { execSync } = require('child_process')

if (!fs.existsSync('node_modules'))
	execSync('npm install', { stdio: 'inherit' })
