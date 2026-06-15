'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pino = require('pino');

const LOG_DIR = path.join(__dirname, '..', 'log');
const LOG_FILE = path.join(LOG_DIR, 'server.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

const streams = [
  { stream: process.stdout },
  {
    stream: pino.destination({
      dest: LOG_FILE,
      mkdir: true,
      sync: false,
    }),
  },
];

const logger = pino(
  {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream(streams)
);

logger.logDir = LOG_DIR;
logger.logFile = LOG_FILE;

module.exports = logger;
