import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `\n[${timestamp}] ${level}: ${message}\n`;
    })
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
