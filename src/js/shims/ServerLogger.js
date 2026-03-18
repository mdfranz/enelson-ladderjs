import pino from 'pino';

const dest = process.env.LOG_FILE 
  ? pino.destination({ dest: process.env.LOG_FILE, sync: true }) 
  : pino.destination(1); // 1 is stdout

const logger = pino({
  timestamp: pino.stdTimeFunctions.isoTime
}, dest);

export default logger;
