import express, { NextFunction, Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { databaseService } from './src/server/database.service.js';
import { schemaService } from './src/server/schema.service.js';
import { sqlGenerationService } from './src/server/sql-generation.service.js';
import { authService } from './src/server/auth.service.js';
import { auditService } from './src/server/audit.service.js';
import { checkOllamaStatus, OLLAMA_MODEL } from './src/server/ai.js';
import { checkPostgresConnection } from './src/server/db.js';
import { departmentService } from './src/server/department.service.js';
import { studentService } from './src/server/student.service.js';
import { importService, ImportTableName } from './src/server/import.service.js';
import { permissionsService } from './src/server/permissions.service.js';
import { User, UserRole } from './src/types/index.js';
import { describeError } from './src/server/errors.js';

 dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = 'arcgpt_session';
const sessionMaxAgeMs = 8 * 60 * 60 * 1000;

/**
 * The ArcGPT chat surface is a single, deliberately uncredentialed screen: it
 * has no login form, and the design is not to be changed to add one. The rest of
 * the API is nonetheless session-gated, so a browser arriving with no cookie
 * would get 401 on its very first message.
 *
 * To reconcile the two, development (and only development) mints a session for
 * the first-run bootstrap administrator when no valid cookie is present. The
 * credentials are read from `LOCAL_ADMIN_*` on the server, the resulting
 * session is a normal row in `arcgpt_sessions`, and the browser only ever holds
 * the HTTP-only cookie. Set `LOCAL_AUTO_SESSION=false` to turn it off even in
 * development; it is unconditionally off when `NODE_ENV=production`, where a
 * real login is required.
 */
const allowBootstrapSession = !isProduction && process.env.LOCAL_AUTO_SESSION !== 'false';

/**
 * The bootstrap session is cached in-process so that a client with cookies
 * disabled does not insert a fresh `arcgpt_sessions` row on every single API
 * call. Cached well inside the 8 hour session lifetime; the token is still
 * re-validated against PostgreSQL on every request that presents it.
 */
let cachedBootstrapSession: { token: string; user: User; issuedAt: number } | null = null;
const bootstrapSessionReuseMs = 7 * 60 * 60 * 1000;

async function resolveBootstrapSession(): Promise<{ token: string; user: User } | null> {
  if (cachedBootstrapSession && Date.now() - cachedBootstrapSession.issuedAt < bootstrapSessionReuseMs) {
    return { token: cachedBootstrapSession.token, user: cachedBootstrapSession.user };
  }
  try {
    const session = await authService.loginAsBootstrapUser();
    if (!session) return null;
    cachedBootstrapSession = { ...session, issuedAt: Date.now() };
    return { token: session.token, user: session.user };
  } catch (error) {
    console.error('[Auth] bootstrap session failed:', describeError(error, 'unknown error'));
    return null;
  }
}

type AuthenticatedRequest = Request & { user?: User };

const roleIsAdmin = (user: User): boolean => ['Admin', 'SUPER_ADMIN'].includes(user.role);

function requestOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void): void {
  if (!origin) {
    callback(null, true);
    return;
  }
  const configured = (process.env.APP_URL || 'http://localhost:3000')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  /**
   * Development origins.
   *
   * 3000 is the single-origin setup, where this process serves the UI itself.
   * 5173 is the split setup: the Vite dev server proxies `/api` here, so the
   * browser's page origin is 5173 and that is the `Origin` header on every
   * mutating request. Both are needed, and both are refused in production.
   */
  const localOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  if (isProduction ? configured.includes(origin) : [...configured, ...localOrigins].includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error('Origin is not allowed.'));
}

function parseLimit(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function isValidRole(value: unknown): value is UserRole {
  return typeof value === 'string' && ['Admin', 'SUPER_ADMIN', 'Principal', 'HOD', 'Faculty', 'Student', 'Accounts', 'Placement Officer', 'Librarian'].includes(value);
}

async function resolveUser(req: Request, res: Response): Promise<User | null> {
  const token = req.cookies?.[sessionCookieName];
  if (typeof token !== 'string' || !token) return null;
  try {
    return await authService.getUserBySession(token);
  } catch (error) {
    console.error('[Auth] session lookup failed:', describeError(error, 'unknown error'));
    res.status(503).json({ error: 'Local authentication service is unavailable.' });
    return null;
  }
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!roleIsAdmin(req.user)) {
    res.status(403).json({ error: 'Administrator role required.' });
    return;
  }
  next();
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: sessionMaxAgeMs,
    path: '/',
  });
}

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));
  app.use(cors({ origin: requestOrigin, credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ limit: '10mb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

  await databaseService.initialize().catch(error => console.error('[DB INIT]', describeError(error, 'unknown error')));
  await schemaService.refreshFromDatabase();
  await authService.bootstrapFromEnvironment().catch(error => console.error('[Auth bootstrap]', describeError(error, 'unknown error')));

  app.use('/api', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.path === '/health' || req.path === '/auth/login' || req.path === '/auth/demo-personas') {
      next();
      return;
    }
    req.user = await resolveUser(req, res) || undefined;
    if (res.headersSent) return;
    if (!req.user && allowBootstrapSession) {
      const bootstrap = await resolveBootstrapSession();
      if (bootstrap) {
        setSessionCookie(res, bootstrap.token);
        req.user = bootstrap.user;
      }
    }
    next();
  });

  app.get('/api/auth/demo-personas', (_req: Request, res: Response) => {
    res.json([
      { role: 'Admin', scope: 'Institutional administration' },
      { role: 'HOD', scope: 'Department-scoped academic data' },
      { role: 'Faculty', scope: 'Authorized academic data' },
      { role: 'Student', scope: 'Personal academic records' },
    ]);
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || email.length > 320 || password.length > 512) {
      res.status(400).json({ error: 'A valid email and password are required.' });
      return;
    }
    try {
      const session = await authService.login(email, password);
      if (!session) {
        await auditService.logEvent({ requestId: `login_${Date.now()}`, userId: '00000000-0000-0000-0000-000000000000', action: 'LOGIN_FAILED', resource: 'LOCAL_AUTH', status: 'FAILED' });
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }
      setSessionCookie(res, session.token);
      await auditService.logEvent({ requestId: `login_${Date.now()}`, userId: session.user.id, action: 'USER_LOGIN', resource: 'LOCAL_AUTH', status: 'SUCCESS' });
      res.json({ user: session.user });
    } catch (error) {
      console.error('[Auth] login failed:', describeError(error, 'unknown error'));
      res.status(503).json({ error: 'Local authentication service is unavailable.' });
    }
  });

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    const token = req.cookies?.[sessionCookieName];
    try {
      if (typeof token === 'string') await authService.logout(token);
    } finally {
      res.clearCookie(sessionCookieName, { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' });
      res.json({ success: true });
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  const queryHandler = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'sql')) {
      res.status(400).json({ error: 'Raw SQL is not accepted. Submit a natural-language question.' });
      return;
    }
    const question = typeof req.body?.question === 'string' ? req.body.question : req.body?.query;
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
      res.status(400).json({ error: 'question is required and must be between 1 and 2000 characters.' });
      return;
    }
    const history = Array.isArray(req.body?.conversationHistory) ? req.body.conversationHistory.slice(-20) : [];
    const safeHistory = history.filter((item: unknown): item is { role: 'user' | 'assistant'; content: string; sql?: string } => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;
      return (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string';
    }).map((item: { role: 'user' | 'assistant'; content: string; sql?: string }) => ({ role: item.role, content: item.content.slice(0, 2000), sql: typeof item.sql === 'string' ? item.sql.slice(0, 10000) : undefined }));
    const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : undefined;
    try {
      const result = await sqlGenerationService.processQuery(question.trim(), req.user, safeHistory, conversationId);
      res.json(result);
    } catch (error) {
      console.error('[Query] pipeline failure:', describeError(error, 'unknown error'));
      res.status(500).json({ error: 'The query pipeline failed.' });
    }
  };

  app.post('/api/query', requireAuth, queryHandler);
  app.post('/api/query/translate', requireAuth, queryHandler);

  // Conversations. `processQuery` already persists turns when a conversationId
  // is supplied; these routes are what the chat-history sidebar reads back, so
  // the sidebar keeps its existing UI and only its data source is replaced.
  app.get('/api/conversations', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      res.json(await databaseService.listConversations(req.user!.id, parseLimit(req.query.limit, 50, 200)));
    } catch {
      res.status(503).json({ error: 'Conversations are unavailable because local PostgreSQL is not accessible.' });
    }
  });

  app.get('/api/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const messages = await databaseService.getConversationMessages(req.user!.id, req.params.id);
      if (!messages) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }
      res.json({ conversationId: req.params.id, messages });
    } catch {
      res.status(503).json({ error: 'Conversation messages are unavailable.' });
    }
  });

  app.delete('/api/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const deleted = await databaseService.deleteConversation(req.user!.id, req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Unable to delete conversation.' });
    }
  });

  app.get('/api/schema', requireAuth, async (_req: Request, res: Response) => {
    try {
      await schemaService.refreshFromDatabase();
      res.json({ tables: schemaService.getAllSchemas(), relationships: schemaService.getRelationships(), source: schemaService.isLoadedFromDatabase() ? 'postgresql' : 'declared' });
    } catch {
      res.status(503).json({ error: 'Schema metadata is unavailable.' });
    }
  });

  app.get('/api/admin/schema', requireAdmin, (_req: Request, res: Response) => {
    res.json({ tables: schemaService.getAllSchemas(), relationships: schemaService.getRelationships() });
  });

  app.get('/api/history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = parseLimit(req.query.limit, 50, 500);
      const history = await databaseService.getQueryHistory(limit, roleIsAdmin(req.user!) ? undefined : req.user!.id);
      res.json(history);
    } catch {
      res.status(503).json({ error: 'Query history is unavailable because local PostgreSQL is not accessible.' });
    }
  });

  app.delete('/api/history/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = roleIsAdmin(req.user!) ? undefined : req.user!.id;
      const result = userId
        ? await databaseService.deleteHistory(req.params.id, userId)
        : await databaseService.deleteHistory(req.params.id);
      if (!result) {
        res.status(404).json({ error: 'Query history entry not found.' });
        return;
      }
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Unable to delete query history.' });
    }
  });

  app.get('/api/admin/queries', requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await databaseService.getAllAiQueries(parseLimit(req.query.limit, 100, 500)));
    } catch {
      res.status(503).json({ error: 'Query monitor is unavailable.' });
    }
  });

  app.get('/api/admin/security-events', requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await databaseService.getSecurityEvents(parseLimit(req.query.limit, 100, 500)));
    } catch {
      res.status(503).json({ error: 'Security monitor is unavailable.' });
    }
  });

  app.get('/api/audit-logs', requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await databaseService.getAuditLogs(parseLimit(req.query.limit, 100, 500)));
    } catch {
      res.status(503).json({ error: 'Audit logs are unavailable.' });
    }
  });

  app.get('/api/stats', requireAuth, async (_req: Request, res: Response) => {
    try {
      res.json(await databaseService.getSystemStatistics());
    } catch {
      res.status(503).json({ error: 'System statistics are unavailable because local PostgreSQL is not accessible.' });
    }
  });

  app.get('/api/insights', requireAuth, async (_req: Request, res: Response) => {
    try {
      res.json(await databaseService.getQuickInsights());
    } catch {
      res.status(503).json({ error: 'Insights are unavailable because local PostgreSQL is not accessible.' });
    }
  });

  app.get('/api/analytics', requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await databaseService.getSystemAnalytics());
    } catch {
      res.status(503).json({ error: 'System analytics are unavailable.' });
    }
  });

  app.get('/api/admin/ai-config', requireAdmin, async (_req: Request, res: Response) => {
    res.json(await databaseService.getAiConfiguration());
  });

  app.post('/api/admin/ai-config', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await databaseService.updateAiConfiguration(req.body || {}, req.user!.id);
      await auditService.logEvent({ requestId: `config_${Date.now()}`, userId: req.user!.id, action: 'AI_CONFIG_UPDATED', resource: 'SYSTEM_SETTINGS', status: 'SUCCESS' });
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Unable to update local AI configuration.' });
    }
  });

  app.get('/api/saved-queries', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      res.json(await databaseService.getSavedQueries(req.user!.id));
    } catch {
      res.status(503).json({ error: 'Saved queries are unavailable.' });
    }
  });

  app.post('/api/saved-queries', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const naturalQuery = typeof req.body?.query === 'string' ? req.body.query.trim() : typeof req.body?.natural_language_query === 'string' ? req.body.natural_language_query.trim() : '';
    if (!title || !naturalQuery || title.length > 200 || naturalQuery.length > 2000) {
      res.status(400).json({ error: 'A title and natural-language query are required.' });
      return;
    }
    try {
      const id = await databaseService.createSavedQuery(req.user!.id, title, naturalQuery, typeof req.body?.description === 'string' ? req.body.description : undefined);
      await auditService.logEvent({ requestId: `saved_${Date.now()}`, userId: req.user!.id, action: 'SAVED_QUERY_CREATED', resource: 'SAVED_QUERIES', status: 'SUCCESS' });
      res.status(201).json({ success: true, id });
    } catch {
      res.status(503).json({ error: 'Unable to save query.' });
    }
  });

  app.put('/api/saved-queries/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const naturalQuery = typeof req.body?.query === 'string' ? req.body.query.trim() : typeof req.body?.natural_language_query === 'string' ? req.body.natural_language_query.trim() : '';
    if (!title || !naturalQuery) {
      res.status(400).json({ error: 'A title and natural-language query are required.' });
      return;
    }
    try {
      const updated = await databaseService.updateSavedQuery(req.params.id, req.user!.id, title, naturalQuery);
      if (!updated) {
        res.status(404).json({ error: 'Saved query not found.' });
        return;
      }
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Unable to update saved query.' });
    }
  });

  app.delete('/api/saved-queries/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const deleted = await databaseService.deleteSavedQuery(req.params.id, req.user!.id);
      if (!deleted) {
        res.status(404).json({ error: 'Saved query not found.' });
        return;
      }
      await auditService.logEvent({ requestId: `saved_delete_${Date.now()}`, userId: req.user!.id, action: 'SAVED_QUERY_DELETED', resource: 'SAVED_QUERIES', status: 'SUCCESS' });
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Unable to delete saved query.' });
    }
  });

  app.post('/api/feedback', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const queryId = typeof req.body?.queryId === 'string' ? req.body.queryId : '';
    const rating = req.body?.rating === 'HELPFUL' || req.body?.rating === 'NOT_HELPFUL' ? req.body.rating : null;
    if (!queryId || !rating) {
      res.status(400).json({ error: 'A valid query ID and rating are required.' });
      return;
    }
    try {
      await databaseService.insertFeedback(queryId, rating, typeof req.body?.comment === 'string' ? req.body.comment : undefined, req.user!.id);
      res.json({ success: true });
    } catch {
      res.status(503).json({ error: 'Unable to record feedback.' });
    }
  });

  // User Directory
  const getUsersHandler = async (_req: Request, res: Response) => {
    try {
      res.json(await authService.getAllUsers());
    } catch {
      res.status(503).json({ error: 'User directory is unavailable.' });
    }
  };
  app.get('/api/users', requireAdmin, getUsersHandler);
  app.get('/api/admin/users', requireAdmin, getUsersHandler);

  // Departments List (for dropdowns and validation)
  app.get('/api/admin/departments', requireAuth, async (_req: Request, res: Response) => {
    try {
      res.json(await departmentService.getAllDepartments());
    } catch {
      res.status(503).json({ error: 'Department list is unavailable.' });
    }
  });

  // Roles and Permissions List
  app.get('/api/admin/roles', requireAdmin, async (_req: Request, res: Response) => {
    res.json(await databaseService.getRolesAndPermissions());
  });

  // Create User
  const createUserHandler = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const { name, firstName, lastName, email, password, role, phone, departmentCode, departmentId, studentId } = req.body || {};
    const fullName = name ? String(name).trim() : `${firstName || ''} ${lastName || ''}`.trim();
    if (!fullName || !email || !password || !role) {
      res.status(400).json({ error: 'Name, email, password, and role are required.' });
      return;
    }
    try {
      const user = await authService.createUser(req.user, {
        name: fullName,
        email: String(email).trim(),
        password: String(password),
        role: role as UserRole,
        phone: phone ? String(phone).trim() : undefined,
        departmentCode: departmentCode ? String(departmentCode).trim() : undefined,
        departmentId: departmentId ? String(departmentId).trim() : undefined,
        studentId: studentId ? String(studentId).trim() : undefined,
      });
      res.status(201).json(user);
    } catch (error) {
      const msg = describeError(error, 'Unable to create user.');
      const status = msg.startsWith('FORBIDDEN') ? 403 : 400;
      res.status(status).json({ error: msg });
    }
  };
  app.post('/api/users', requireAdmin, createUserHandler);
  app.post('/api/admin/users', requireAdmin, createUserHandler);

  // Edit User Details (Protected with field whitelisting & role checks)
  const updateUserHandler = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    try {
      const user = await authService.updateUser(req.params.id, req.user, req.body || {});
      res.json(user);
    } catch (error) {
      const msg = describeError(error, 'Unable to update user.');
      const status = msg.startsWith('FORBIDDEN') ? 403 : 400;
      res.status(status).json({ error: msg });
    }
  };
  app.put('/api/users/:id', requireAdmin, updateUserHandler);
  app.put('/api/admin/users/:id', requireAdmin, updateUserHandler);

  // Toggle User Active / Disabled Status
  const toggleStatusHandler = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    try {
      const user = await authService.toggleUserStatus(req.params.id, req.user);
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }
      res.json(user);
    } catch (error) {
      res.status(400).json({ error: describeError(error, 'Unable to toggle user status.') });
    }
  };
  app.post('/api/users/:id/toggle-status', requireAdmin, toggleStatusHandler);
  app.post('/api/admin/users/:id/toggle-status', requireAdmin, toggleStatusHandler);

  // Student Directory & Management (Enforces HOD Department Scoping)
  const getStudentsHandler = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    try {
      const result = await studentService.getStudents(req.user, {
        requestedDepartmentId: typeof req.query.departmentId === 'string' ? req.query.departmentId : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: describeError(error, 'Unable to retrieve students.') });
    }
  };
  app.get('/api/students', requireAuth, getStudentsHandler);
  app.get('/api/admin/students', requireAuth, getStudentsHandler);

  // Remove Student (Safe soft-deletion with INACTIVE status and audit log)
  const removeStudentHandler = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    try {
      const student = await studentService.removeStudent(req.params.id, req.user, req.body?.reason);
      res.json({ success: true, message: 'Student removed successfully.', student });
    } catch (error) {
      const msg = describeError(error, 'Unable to remove student.');
      const status = msg.includes('FORBIDDEN') ? 403 : 400;
      res.status(status).json({ error: msg });
    }
  };
  app.post('/api/admin/students/:id/remove', requireAdmin, removeStudentHandler);
  app.delete('/api/admin/students/:id', requireAdmin, removeStudentHandler);

  // Reactivate Student
  app.post('/api/admin/students/:id/reactivate', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    try {
      const student = await studentService.reactivateStudent(req.params.id, req.user);
      res.json({ success: true, message: 'Student reactivated successfully.', student });
    } catch (error) {
      res.status(400).json({ error: describeError(error, 'Unable to reactivate student.') });
    }
  });

  // Data Upload & Import APIs
  app.get('/api/admin/import/tables', requireAdmin, (_req: Request, res: Response) => {
    res.json(importService.getAllowedTables());
  });

  app.get('/api/admin/import/template/:table', requireAdmin, (req: Request, res: Response) => {
    const table = req.params.table as ImportTableName;
    try {
      const csv = importService.getCsvTemplate(table);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${table}_template.csv"`);
      res.send(csv);
    } catch (error) {
      res.status(404).json({ error: describeError(error, 'Template not found.') });
    }
  });

  app.post('/api/admin/import/preview', requireAdmin, async (req: Request, res: Response) => {
    const { table, csvContent } = req.body || {};
    if (!table || typeof csvContent !== 'string') {
      res.status(400).json({ error: 'table and csvContent are required.' });
      return;
    }
    try {
      const preview = await importService.validateImport(table as ImportTableName, csvContent);
      res.json(preview);
    } catch (error) {
      res.status(400).json({ error: describeError(error, 'Validation failed.') });
    }
  });

  app.post('/api/admin/import/execute', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const { table, csvContent } = req.body || {};
    if (!table || typeof csvContent !== 'string') {
      res.status(400).json({ error: 'table and csvContent are required.' });
      return;
    }
    try {
      const result = await importService.executeImport(table as ImportTableName, csvContent, req.user);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: describeError(error, 'Import failed.') });
    }
  });

  app.get('/api/connection/status', requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await databaseService.getConnectionStatus());
    } catch {
      res.status(503).json({ error: 'Database connection status is unavailable.' });
    }
  });

  app.post('/api/connection/test', requireAdmin, async (_req: Request, res: Response) => {
    const start = Date.now();
    try {
      const status = await databaseService.getConnectionStatus();
      if (status.status !== 'Connected') {
        res.status(503).json({ success: false, error: 'PostgreSQL is offline.' });
        return;
      }
      res.json({ success: true, message: `Local PostgreSQL connected. Students: ${status.studentCount}`, studentCount: status.studentCount, latency: `${Date.now() - start}ms` });
    } catch {
      res.status(503).json({ success: false, error: 'PostgreSQL connection test failed.' });
    }
  });

  app.get('/api/health', async (_req: Request, res: Response) => {
    const [ollama, postgres] = await Promise.all([checkOllamaStatus(), checkPostgresConnection()]);
    res.json({
      server: 'ok',
      ollama: ollama.available ? 'ok' : 'offline',
      postgresql: postgres ? 'ok' : 'offline',
      ollama_model: OLLAMA_MODEL,
    });
  });

  app.get('/api/debug/database', requireAdmin, async (_req: Request, res: Response) => {
    if (isProduction) {
      res.status(404).json({ error: 'Not found.' });
      return;
    }
    try {
      res.json(await databaseService.getDebugReport());
    } catch (error) {
      res.status(503).json({ connected: false, error: describeError(error, 'Database diagnostic failed.') });
    }
  });

  app.post('/api/schema/refresh', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const loaded = await schemaService.refreshFromDatabase();
    await auditService.logEvent({ requestId: `schema_${Date.now()}`, userId: req.user!.id, action: 'SCHEMA_REFRESHED', resource: 'POSTGRESQL_SCHEMA', status: 'SUCCESS' });
    res.json({ success: true, source: loaded ? 'postgresql' : 'declared' });
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  // Static/production mounting serves the ArcGPT *frontend* (Project 1), not
  // anything in this directory. The two are same-origin on purpose: the session
  // cookie is `sameSite: 'strict'`, so a browser calling the API from another
  // port directly would never present it and every call would 401.
  //
  // `SERVE_FRONTEND=false` is the exception, for split development: Vite runs
  // on 5173 with hot reload and proxies /api here (see frontend/vite.config.ts).
  // Because the browser only ever sees 5173, the cookie stays first-party.
  const frontendDir = path.resolve(__dirname, '..', 'frontend');
  const serveFrontend = process.env.SERVE_FRONTEND !== 'false';

  if (serveFrontend && !isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: frontendDir,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (serveFrontend) {
    app.use(express.static(path.join(frontendDir, 'dist')));
    app.get('*', (_req: Request, res: Response) => res.sendFile(path.join(frontendDir, 'dist', 'index.html')));
  } else {
    // API-only: a request for a page gets an honest explanation rather than
    // Express's bare 404, since this process deliberately serves no UI.
    app.use((_req: Request, res: Response) => {
      res.status(404).json({
        error: 'API-only mode (SERVE_FRONTEND=false). Run `npm run dev` in ../frontend for the UI.',
      });
    });
  }

  const server = app.listen(PORT, '0.0.0.0', async () => {
    const [ollama, postgres] = await Promise.all([checkOllamaStatus(), checkPostgresConnection()]);
    console.log('ArcGPT Local');
    console.log('-------------------------');
    console.log(`PostgreSQL: ${postgres ? 'CONNECTED' : 'OFFLINE'}`);
    console.log(`Ollama: ${ollama.available ? 'CONNECTED' : 'OFFLINE'}`);
    console.log(`Model: ${OLLAMA_MODEL}`);
    console.log(`Database: ${process.env.DB_NAME || 'arcgpt_institution'}`);
    console.log('Server: RUNNING');
    console.log('-------------------------');
  });

  const shutdown = async () => {
    server.close();
    const { closeDatabasePools } = await import('./src/server/db.js');
    await closeDatabasePools();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer().catch(error => {
  console.error('Fatal server startup failure:', describeError(error, 'unknown error'));
  process.exit(1);
});
