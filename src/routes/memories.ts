/**
 * Memories Routes
 * 
 * CRUD operations for memories using Supabase with vector embeddings
 */

import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateApiKey } from '../middleware/auth.js';
import { CreateMemoryRequest, Memory } from '../types/recallbricks.js';
import OpenAI from 'openai';

const router = Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Function to extract key information using OpenAI GPT-4o-mini
async function extractKeyInfo(text: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Extract only key information: decisions, code, facts. Remove explanations and filler.'
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    const extracted = completion.choices[0]?.message?.content?.trim();
    return extracted || text;
  } catch (error) {
    console.error('Error extracting key information:', error);
    // If extraction fails, return original text
    return text;
  }
}

// Function to generate embedding
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

// Temporary: Create mock user if auth is bypassed
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    // Mock user for testing without auth
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
 * POST /api/v1/memories
 * Create a new memory with vector embedding
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { text, source, project_id, tags, metadata }: CreateMemoryRequest = req.body;

    if (!text) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Text is required.'
      });
      return;
    }

    // Extract key information using OpenAI GPT-4o-mini
    const extractedText = await extractKeyInfo(text);

    // Generate embedding for semantic search using extracted text
    const embedding = await generateEmbedding(extractedText);

    const memory = {
      user_id: user.id,
      text: extractedText, // Save the extracted key information
      source: source || 'api',
      project_id: project_id || 'default',
      tags: tags || [],
      metadata: {
        ...metadata,
        original_text: text, // Preserve original text in metadata
        extracted: true
      },
      embedding: `[${embedding.join(',')}]`, // Convert to pgvector string format
    };

    const { data, error } = await supabase
      .from('memories')
      .insert(memory)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating memory:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to create memory.'
    });
  }
});

/**
 * GET /api/v1/memories
 * List memories with optional filters
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { limit, source, project_id } = req.query;

    let query = supabase
      .from('memories')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (limit) {
      query = query.limit(parseInt(limit as string));
    }

    if (source) {
      query = query.eq('source', source);
    }

    if (project_id) {
      query = query.eq('project_id', project_id);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      memories: data,
      count: data?.length || 0
    });
  } catch (error: any) {
    console.error('Error listing memories:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to retrieve memories.'
    });
  }
});

/**
 * GET /api/v1/memories/search
 * Semantic search using vector similarity
 */
router.get('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { q, limit = 10 } = req.query;

    if (!q || typeof q !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Query parameter "q" is required.'
      });
      return;
    }

    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(q);

    // Use Supabase RPC for vector similarity search
    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.5,
      match_count: parseInt(limit as string),
      filter_user_id: user.id
    });

    if (error) throw error;

    res.json({
      memories: data || [],
      count: data?.length || 0,
      query: q
    });
  } catch (error: any) {
    console.error('Error searching memories:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to search memories.'
    });
  }
});

/**
 * POST /api/v1/memories/search
 * Semantic search using vector similarity (POST version for body params)
 */
router.post('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { query, limit = 10 } = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Query field is required.'
      });
      return;
    }

    const queryEmbedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.5,
      match_count: parseInt(String(limit)),
      filter_user_id: user.id
    });

    if (error) throw error;

    res.json({
      memories: data || [],
      count: data?.length || 0,
      query
    });
  } catch (error: any) {
    console.error('Error searching memories:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to search memories.'
    });
  }
});

/**
 * GET /api/v1/memories/context
 * Auto-context endpoint: Returns clean text-only results for AI consumption
 */
router.get('/context', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { q, limit = 10 } = req.query;

    if (!q || typeof q !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Query parameter "q" is required.'
      });
      return;
    }

    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(q);

    // Use Supabase RPC for vector similarity search
    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.5,
      match_count: parseInt(limit as string),
      filter_user_id: user.id
    });

    if (error) throw error;

    // Extract only the text field for clean AI consumption
    const context = (data || []).map((memory: any) => memory.text);

    res.json({
      context,
      count: context.length
    });
  } catch (error: any) {
    console.error('Error generating context:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to generate context.'
    });
  }
});

/**
 * GET /api/v1/memories/context/all
 * Get all memories for the authenticated user as clean text context
 */
router.get('/context/all', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { limit = 100, offset = 0 } = req.query;

    // Fetch all memories for the user, ordered by most recent
    const { data, error } = await supabase
      .from('memories')
      .select('text')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(
        parseInt(offset as string),
        parseInt(offset as string) + parseInt(limit as string) - 1
      );

    if (error) throw error;

    // Extract only the text field for clean AI consumption
    const context = (data || []).map((memory: any) => memory.text);

    res.json({
      context,
      count: context.length,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });
  } catch (error: any) {
    console.error('Error retrieving all context:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to retrieve all context.'
    });
  }
});

/**
 * GET /api/v1/memories/test-extraction
 * Test endpoint to verify OpenAI extraction is working
 */
router.get('/test-extraction', async (req: Request, res: Response): Promise<void> => {
  try {
    const testText = "Hey! I decided to use PostgreSQL instead of MongoDB. Here's my code: const x = 5; I prefer dark mode.";

    // Check if API key exists
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({
        error: 'Configuration Error',
        message: 'OPENAI_API_KEY is not set',
        apiKeyExists: false
      });
      return;
    }

    // Test extraction
    const extracted = await extractKeyInfo(testText);

    res.json({
      success: true,
      apiKeyExists: true,
      apiKeyPrefix: process.env.OPENAI_API_KEY.substring(0, 7) + '...',
      original: testText,
      extracted: extracted,
      extractionWorked: extracted !== testText
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Extraction Failed',
      message: error.message,
      apiKeyExists: !!process.env.OPENAI_API_KEY
    });
  }
});

/**
 * GET /api/v1/memories/:id
 * Get a single memory by ID
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Memory not found.'
      });
      return;
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error getting memory:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to retrieve memory.'
    });
  }
});

/**
 * DELETE /api/v1/memories/:id
 * Delete a memory by ID
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const { error } = await supabase
      .from('memories')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;

    res.json({
      message: 'Memory deleted successfully.',
      id
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to delete memory.'
    });
  }
});

/**
 * PUT /api/v1/memories/:id
 * Update a memory by ID (regenerates embedding if text changes)
 */
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { text, tags, metadata, project_id } = req.body;

    const updates: any = {};
    if (text) {
      updates.text = text;
      // Regenerate embedding if text changed
      const newEmbedding = await generateEmbedding(text);
      updates.embedding = `[${newEmbedding.join(',')}]`;
    }
    if (tags) updates.tags = tags;
    if (metadata) updates.metadata = metadata;
    if (project_id) updates.project_id = project_id;

    const { data, error } = await supabase
      .from('memories')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      res.status(404).json({
        error: 'Not Found',
        message: 'Memory not found.'
      });
      return;
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error updating memory:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to update memory.'
    });
  }
});

export default router;

