/**
 * RecallBricks API v2.0 - Production-Grade
 *
 * Express API with production features:
 * - Circuit breaker for database
 * - Rate limiting with proper headers
 * - Structured logging with request IDs
 * - Enhanced error handling
 * - Health check endpoints
 * - Observability (Prometheus metrics)
 * - Graceful shutdown
 * - Security headers
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

// Middleware
import { requestContextMiddleware } from './middleware/requestContext.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalRateLimit, apiKeyRateLimit, rateLimitStatusEndpoint } from './middleware/rateLimit.js';

// Routes
import memoriesRouter from './routes/memories.js';
import contextRouter from './routes/context.js';
import healthRouter from './routes/health.js';

// Utilities
import { logger } from './utils/logger.js';
import { Errors } from './utils/errors.js';
import { testConnection } from './config/supabase.js';

// Load environment variables
dotenv.config();

// ------- Supabase (env + client) -------
import { createClient } from "@supabase/supabase-js";

function must(name: string) {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    logger.error(`Missing required environment variable: ${name}`);
    throw new Error(`[BOOT] Missing env: ${name}`);
  }
  return v.trim();
}

const SUPABASE_URL = must("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = must("SUPABASE_SERVICE_ROLE_KEY");

logger.info('Supabase configuration loaded', {
  url: SUPABASE_URL,
  keyLength: SUPABASE_SERVICE_ROLE_KEY.length,
});

export const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ------- Express HTTP API -------
const app = express();
const PORT = parseInt(process.env.PORT || '8080');
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
  credentials: true,
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Trust proxy (important for Railway, Render, etc.)
app.set('trust proxy', 1);

// Add request context (request ID, metrics)
app.use(requestContextMiddleware);

// Request logging
app.use(requestLoggerMiddleware);

// Global rate limiter
app.use(globalRateLimit);

// Health checks (no authentication required)
app.use(healthRouter);

// Root endpoint
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "RecallBricks API",
    version: "2.0.0",
    description: "The Memory Layer for AI - Production Ready",
    database: "Supabase PostgreSQL",
    features: [
      "Circuit Breaker Protection",
      "Rate Limiting",
      "Structured Logging",
      "Health Checks",
      "Prometheus Metrics",
      "Request Validation",
    ],
    status: "healthy",
    environment: NODE_ENV,
  });
});

// API v1 routes (with authentication and rate limiting)
app.use('/api/v1/memories', memoriesRouter);
app.use('/api/v1', contextRouter);
app.get('/api/v1/rate-limit', apiKeyRateLimit, rateLimitStatusEndpoint);

// 404 handler
app.use((req: Request, res: Response) => {
  throw Errors.routeNotFound(req.method, req.path);
});

// Global error handler (must be last)
app.use(errorHandler);

// ------- Server Startup -------
let server: any;

async function startServer() {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    const dbConnected = await testConnection();

    if (!dbConnected) {
      logger.warn('Database connection failed, but starting server anyway (will use circuit breaker)');
    }

    // Start HTTP server
    server = app.listen(PORT, () => {
      logger.info('RecallBricks API v2.0.0 started successfully', {
        port: PORT,
        environment: NODE_ENV,
        database: dbConnected ? 'connected' : 'disconnected',
        features: {
          circuitBreaker: true,
          rateLimiting: true,
          structuredLogging: true,
          healthChecks: true,
          metrics: true,
        },
      });
    });
  } catch (error: any) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// ------- Graceful Shutdown -------
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, forcing exit...');
    process.exit(1);
  }

  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }

  // Give active requests time to complete (30 seconds)
  const shutdownTimeout = setTimeout(() => {
    logger.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, 30000);

  try {
    // Allow time for in-flight requests
    await new Promise(resolve => setTimeout(resolve, 2000));

    clearTimeout(shutdownTimeout);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during shutdown', {
      error: error.message,
    });
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled rejection', {
    reason: reason?.message || String(reason),
    stack: reason?.stack,
  });
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
startServer();

// ------- MCP server (official SDK over stdio) -------
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";

const text = (obj: unknown) => [{ type: "text", text: JSON.stringify(obj) }];

const toolDefs = [
  {
    name: "ping",
    description: "Connectivity check for MCP server",
    schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "supabase_health",
    description: "HEAD-style check against the memories table",
    schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "putMemory",
    description: "Upsert a memory row into public.memories",
    schema: {
      type: "object",
      required: ["id", "user_id", "text"],
      properties: {
        id: { type: "string", description: "UUID" },
        user_id: { type: "string", description: "UUID" },
        text: { type: "string" },
        meta: {},
      },
      additionalProperties: false,
    },
  },
  {
    name: "getMemory",
    description: "Fetch one memory by id",
    schema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "UUID" } },
      additionalProperties: false,
    },
  },
  {
    name: "listMemories",
    description: "List recent memories for a user",
    schema: {
      type: "object",
      required: ["user_id"],
      properties: {
        user_id: { type: "string", description: "UUID" },
        limit: { type: "number", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
  },
] as const;

const mcpServer = new Server(
  { name: "recallbricks-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: toolDefs.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema,
    })),
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  try {
    if (name === "ping") {
      return { content: text({ ok: true, mcp: "up" }) };
    }

    if (name === "supabase_health") {
      const { error, count } = await db
        .from("memories")
        .select("id", { head: true, count: "exact" });
      return { content: text({ ok: !error, error: error?.message ?? null, count: count ?? null }) };
    }

    if (name === "putMemory") {
      const { id, user_id, text: bodyText, meta } = args as any;
      const { error } = await db.from("memories").upsert({
        id,
        user_id,
        text: String(bodyText),
        meta: meta ?? null,
      });
      if (error) throw new Error(error.message);
      return { content: text({ ok: true }) };
    }

    if (name === "getMemory") {
      const { id } = args as any;
      const { data, error } = await db.from("memories").select("*").eq("id", id).single();
      // PGRST116 = no rows found
      if (error && (error as any).code !== "PGRST116") throw new Error(error.message);
      return { content: text({ ok: true, memory: data ?? null }) };
    }

    if (name === "listMemories") {
      const { user_id, limit = 20 } = args as any;
      const { data, error } = await db
        .from("memories")
        .select("id,text,created_at")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(Number(limit));
      if (error) throw new Error(error.message);
      return { content: text({ ok: true, items: data ?? [] }) };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (e: any) {
    return { content: text({ ok: false, error: e?.message ?? String(e) }) };
  }
});

// Connect stdio (Claude talks to this)
await mcpServer.connect(new StdioServerTransport());

logger.info('MCP server connected via stdio');
