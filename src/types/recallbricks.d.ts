/**
 * TypeScript Type Definitions for RecallBricks
 */

export interface User {
  id: string;
  email?: string;
  api_key: string;
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  memory_count: number;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, any>;
}

export interface Memory {
  id: string;
  user_id: string;
  text: string;
  source: 'claude' | 'chatgpt' | 'cursor' | 'manual' | 'api';
  project_id: string;
  tags: string[];
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryRequest {
  text: string;
  source?: string;
  project_id?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface ContextRequest {
  query: string;
  llm?: string;
  limit?: number;
  project_id?: string;
  conversation_history?: string[]; 
}

// Extend Express Request to include user and authentication info
declare global {
  namespace Express {
    interface Request {
      user?: User;
      userId?: string;
      userEmail?: string;
      authMethod?: 'jwt' | 'api-key';
    }
  }
}
