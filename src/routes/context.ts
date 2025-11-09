/**
 * Context Routes
 * 
 * Semantic search and context retrieval for cross-LLM memory
 */

import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateApiKey } from '../middleware/auth.js';
import { ContextRequest } from '../types/recallbricks.js';
});

const router = Router();

// Temporary: Create mock user if auth is bypassed
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    console.log('[CONTEXT AUTH] Creating mock user');
    req.user = {
      id: '00000000-0000-0000-0000-000000000001',
      api_key: 'mock-key'
    } as any;
  }
  next();
});

// All routes require authentication
// router.use(authenticateApiKey);

/**
 * POST /api/v1/context
 * Intelligent context retrieval - automatically extracts keywords and finds relevant memories
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { query, llm, limit, project_id, conversation_history }: ContextRequest = req.body;

    if (!query) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Query is required.'
      });
      return;
    }

    // INTELLIGENT KEYWORD EXTRACTION
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'what', 'when', 'where', 'who', 'how', 'why', 'this', 'that', 'these', 'those']);
    
    const keywords = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word: string) => word.length > 2 && !stopWords.has(word))
      .slice(0, 10);

    if (conversation_history && conversation_history.length > 0) {
      const recentContext = conversation_history.slice(-3).join(' ');
      const historyKeywords = recentContext
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((word: string) => word.length > 2 && !stopWords.has(word))
        .slice(0, 5);
      keywords.push(...historyKeywords);
    }

    const searchQuery = keywords.join(' | ');

    let dbQuery = supabase
      .from('memories')
      .select('*')
      .eq('user_id', user.id)
      .textSearch('text_search', searchQuery, {
        type: 'websearch',
        config: 'english'
      })
      .order('created_at', { ascending: false })
      .limit(limit || 10);

    if (project_id) {
      dbQuery = dbQuery.eq('project_id', project_id);
    }

    const { data, error } = await dbQuery;

    if (error) throw error;

    const scoredMemories = (data || []).map((memory: any) => {
      let score = 0;
      const memoryText = memory.text.toLowerCase();
      
      keywords.forEach((keyword: string) => {
        if (memoryText.includes(keyword)) {
          score += 10;
        }
      });
      
      const daysOld = (Date.now() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 5 - daysOld * 0.1);
      
      return { ...memory, relevance_score: score };
    });

    scoredMemories.sort((a: any, b: any) => b.relevance_score - a.relevance_score);

    const sources = new Set(scoredMemories.map((m: any) => m.source));
    const crossLLM = llm && sources.size > 1 && !sources.has(llm);

    res.json({
      query,
      keywords_extracted: keywords,
      memories: scoredMemories.slice(0, limit || 10),
      count: scoredMemories.length,
      crossLLM,
      llm: llm || 'unknown',
      intelligence: {
        keyword_extraction: true,
        relevance_scoring: true,
        conversation_context: !!conversation_history
      }
    });
  } catch (error: any) {
    console.error('Error recalling context:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to recall context.'
    });
  }
});

router.post('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { query, tags, source, project_id, limit } = req.body;

    let dbQuery = supabase
      .from('memories')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit || 50);

    if (query) {
      dbQuery = dbQuery.textSearch('text_search', query, {
        type: 'websearch',
        config: 'english'
      });
    }

    if (tags && tags.length > 0) {
      dbQuery = dbQuery.contains('tags', tags);
    }

    if (source) {
      dbQuery = dbQuery.eq('source', source);
    }

    if (project_id) {
      dbQuery = dbQuery.eq('project_id', project_id);
    }

    const { data, error } = await dbQuery;

    if (error) throw error;

    res.json({
      memories: data || [],
      count: data?.length || 0
    });
  } catch (error: any) {
    console.error('Error searching memories:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to search memories.'
    });
  }
});

export default router;
