import type { ErrorRequestHandler } from "express";
import { logger } from "../lib/logger";

export const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  logger.error(
    {
      err: error,
      requestId: req.id,
      method: req.method,
      path: req.path,
    },
    "Unhandled API request error",
  );
  res.status(500).json({ error: "An unexpected error occurred. Please try again." });
};
