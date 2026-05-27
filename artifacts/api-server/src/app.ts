import express, { type Express } from "express";
import { randomUUID } from "crypto";
import pinoHttp from "pino-http";
import router from "./routes";
import { createCorsMiddleware } from "./lib/cors-config.ts";
import { createSecurityHeadersMiddleware } from "./lib/security-headers.ts";
import {
  serializeHttpRequest,
  serializeHttpResponse,
} from "./lib/http-log-serializers.ts";
import { reportServerError } from "./lib/error-reporter.ts";
import { logger } from "./lib/logger";
// Phase 4 (Task #14): import for side effect — registers all engine
// rule handlers at server boot, BEFORE any route can call emit().
import "./engine/rules/index.ts";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers["x-request-id"];
      const requestId =
        typeof incoming === "string" && incoming.trim().length > 0
          ? incoming.trim()
          : randomUUID();
      res.setHeader("x-request-id", requestId);
      return requestId;
    },
    customProps() {
      return {
        environment: process.env.NODE_ENV ?? "development",
      };
    },
    serializers: {
      req(req) {
        return serializeHttpRequest(req);
      },
      res(res) {
        return serializeHttpResponse(res);
      },
    },
  }),
);
app.use(createSecurityHeadersMiddleware());
app.use(createCorsMiddleware());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    reportServerError(req.log, err, {
      requestId: req.id,
      method: req.method,
      path: req.path,
    });
    res.status(500).json({
      error: "Internal server error",
      requestId: req.id,
    });
  },
);

export default app;
