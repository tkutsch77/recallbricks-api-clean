import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Dual Authentication Middleware
 * Supports both JWT Bearer tokens and API keys
 *
 * JWT Flow:
 * 1. Check Authorization: Bearer {token} header
 * 2. Validate with Supabase Auth getUser()
 * 3. Attach userId, userEmail, authMethod to request
 *
 * API Key Flow:
 * 1. Check X-API-Key header
 * 2. Query api_keys table in Supabase
 * 3. Verify is_active = true
 * 4. Update last_used_at timestamp
 * 5. Attach userId, authMethod to request
 */
export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Check for JWT Bearer token first
    const authHeader = req.headers['authorization'] as string;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      logger.debug('JWT authentication attempt', {
        requestId: req.requestId,
        tokenPrefix: token ? token.substring(0, 10) + '...' : 'MISSING',
      });

      try {
        // Validate JWT with Supabase Auth
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
          logger.warn('Invalid or expired JWT token', {
            requestId: req.requestId,
            error: error?.message,
          });
          throw Errors.unauthorized('Invalid or expired token');
        }

        // Attach user info to request
        req.userId = user.id;
        req.userEmail = user.email;
        req.authMethod = 'jwt';

        // Create user object for backward compatibility
        req.user = {
          id: user.id,
          email: user.email,
          api_key: '',
        } as any;

        logger.info('✓ JWT auth successful for user: ' + user.email, {
          requestId: req.requestId,
          userId: user.id,
        });

        return next();
      } catch (jwtError: any) {
        logger.error('JWT validation error', {
          requestId: req.requestId,
          error: jwtError.message,
        });
        throw Errors.unauthorized('Invalid or expired token');
      }
    }

    // Fall back to API key authentication
    const apiKey = req.headers['x-api-key'] as string;

    logger.debug('API key authentication attempt', {
      requestId: req.requestId,
      hasApiKey: !!apiKey,
      keyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'MISSING',
    });

    if (!apiKey) {
      throw Errors.unauthorized('Authentication required. Provide either Authorization: Bearer {token} or X-API-Key header');
    }

    // Query api_keys table in Supabase
    try {
      const { data: apiKeyData, error: apiKeyError } = await supabase
        .from('api_keys')
        .select('id, user_id, is_active')
        .eq('key', apiKey)
        .single();

      if (apiKeyError || !apiKeyData) {
        logger.warn('Invalid API key attempt', {
          requestId: req.requestId,
          keyPrefix: apiKey.substring(0, 10) + '...',
          error: apiKeyError?.message,
        });
        throw Errors.unauthorized('Invalid API key');
      }

      if (!apiKeyData.is_active) {
        logger.warn('Inactive API key used', {
          requestId: req.requestId,
          keyPrefix: apiKey.substring(0, 10) + '...',
          userId: apiKeyData.user_id,
        });
        throw Errors.unauthorized('API key is inactive');
      }

      // Update last_used_at timestamp
      await supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', apiKeyData.id);

      // Attach user info to request
      req.userId = apiKeyData.user_id;
      req.authMethod = 'api-key';

      // Create user object for backward compatibility
      req.user = {
        id: apiKeyData.user_id,
        api_key: apiKey,
      } as any;

      logger.info('✓ API key auth successful for user: ' + apiKeyData.user_id, {
        requestId: req.requestId,
        userId: apiKeyData.user_id,
      });

      next();
    } catch (dbError: any) {
      logger.error('API key validation error', {
        requestId: req.requestId,
        error: dbError.message,
      });

      // If it's already an Errors.unauthorized, rethrow it
      if (dbError.statusCode === 401) {
        throw dbError;
      }

      // Otherwise throw a generic database error
      throw Errors.databaseError('Failed to validate API key', {
        error: dbError.message,
      });
    }
  } catch (error: any) {
    // Pass error to error handler middleware
    next(error);
  }
}

export default authenticateApiKey;
