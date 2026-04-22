import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const apiMocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  listConversations: vi.fn(),
  makePayload: vi.fn(),
  RateLimitError: class RateLimitError extends Error {
    status: number;
    rateLimit: unknown;

    constructor(message: string, status = 429, rateLimit: unknown = null) {
      super(message);
      this.name = 'RateLimitError';
      this.status = status;
      this.rateLimit = rateLimit;
    }
  },
  renameConversation: vi.fn(),
  sendNonStream: vi.fn(),
  sendStream: vi.fn(),
  toCachedConversation: vi.fn(({ conversation, messages }) => ({
    conversation,
    messages,
    contentText: messages.map((message: { content: string }) => message.content).join(' '),
    lastViewedAt: Date.now()
  }))
}));

const cacheMocks = vi.hoisted(() => ({
  clear: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  put: vi.fn()
}));

vi.mock('./api', () => apiMocks);
vi.mock('./lib/conversation-cache', () => ({
  createConversationCache: () => cacheMocks
}));

describe('App conversation workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiMocks.listConversations.mockResolvedValue({
      items: [
        {
          id: 'c-1',
          user_id: 'u_001',
          title: 'Project Alpha',
          created_at: '2026-04-15T00:00:00.000Z',
          updated_at: '2026-04-15T00:00:00.000Z',
          message_count: 2
        },
        {
          id: 'c-2',
          user_id: 'u_001',
          title: 'Daily Notes',
          created_at: '2026-04-15T00:00:00.000Z',
          updated_at: '2026-04-15T00:00:00.000Z',
          message_count: 1
        }
      ],
      total: 2,
      page: 1,
      page_size: 20
    });

    cacheMocks.list.mockResolvedValue([
      {
        conversation: {
          id: 'c-1',
          user_id: 'u_001',
          title: 'Project Alpha',
          created_at: '2026-04-15T00:00:00.000Z',
          updated_at: '2026-04-15T00:00:00.000Z',
          message_count: 2
        },
        messages: [
          { role: 'user', content: 'cached keyword from alpha' },
          { role: 'assistant', content: 'cached assistant reply' }
        ],
        contentText: 'cached keyword from alpha cached assistant reply',
        lastViewedAt: 10
      }
    ]);
    cacheMocks.get.mockImplementation(async (id: string) => {
      if (id === 'c-1') {
        return {
          conversation: {
            id: 'c-1',
            user_id: 'u_001',
            title: 'Project Alpha',
            created_at: '2026-04-15T00:00:00.000Z',
            updated_at: '2026-04-15T00:00:00.000Z',
            message_count: 2
          },
          messages: [
            { role: 'user', content: 'cached keyword from alpha' },
            { role: 'assistant', content: 'cached assistant reply' }
          ],
          contentText: 'cached keyword from alpha cached assistant reply',
          lastViewedAt: 10
        };
      }
      return null;
    });

    apiMocks.getConversationMessages.mockImplementation(async (id: string) => ({
      conversation: {
        id,
        user_id: 'u_001',
        title: id === 'c-2' ? 'Daily Notes' : 'Project Alpha',
        created_at: '2026-04-15T00:00:00.000Z',
        updated_at: '2026-04-15T00:00:00.000Z',
        message_count: 2
      },
      items:
        id === 'c-2'
          ? [
              { role: 'user', content: 'What did I ship today?' },
              { role: 'assistant', content: 'You shipped the sidebar.' }
            ]
          : [
              { role: 'user', content: 'cached keyword from alpha' },
              { role: 'assistant', content: 'cached assistant reply' }
            ]
    }));

    apiMocks.createConversation.mockResolvedValue({
      conversation: {
        id: 'c-3',
        user_id: 'u_001',
        title: 'New conversation',
        created_at: '2026-04-15T00:00:00.000Z',
        updated_at: '2026-04-15T00:00:00.000Z',
        message_count: 0
      }
    });

    apiMocks.renameConversation.mockResolvedValue({
      conversation: {
        id: 'c-3',
        user_id: 'u_001',
        title: 'Renamed conversation',
        created_at: '2026-04-15T00:00:00.000Z',
        updated_at: '2026-04-15T00:00:00.000Z',
        message_count: 0
      }
    });
    apiMocks.deleteConversation.mockResolvedValue(undefined);
    apiMocks.makePayload.mockImplementation((payload) => payload);
    apiMocks.sendNonStream.mockResolvedValue({
      text: 'default non-stream reply',
      raw: {
        message: { role: 'assistant', content: 'default non-stream reply' },
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        context_tokens_used: 18
      }
    });
    apiMocks.sendStream.mockImplementation(async (_payload, onDelta, onDone) => {
      onDelta('default streamed reply');
      onDone({
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
        context_tokens_used: 24
      });
    });
  });

  it('keeps the conversation workspace constrained to the viewport so the message list can scroll without pushing the composer off-screen', async () => {
    render(<App />);

    expect(await screen.findByText('Project Alpha')).toBeInTheDocument();

    const main = screen.getByRole('main');
    expect(main.className).toContain('h-screen');
    expect(main.className).toContain('overflow-hidden');

    const shell = main.firstElementChild as HTMLElement | null;
    expect(shell?.className).toContain('overflow-hidden');

    const composer = screen.getByPlaceholderText('Type your prompt...').closest('div[class*="border-t"]') as HTMLElement | null;
    expect(composer?.className).toContain('shrink-0');
  });

  it('keeps controls on a single page, filters conversations by title and cached content, shows cached content immediately, then revalidates in background', async () => {
    const user = userEvent.setup();

    let resolveMessages!: (value: any) => void;
    apiMocks.getConversationMessages.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMessages = resolve;
        }) as Promise<any>
    );

    render(<App />);

    expect(await screen.findByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Daily Notes')).toBeInTheDocument();
    expect(screen.getByLabelText('User ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Session ID')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show settings/i })).not.toBeInTheDocument();

    const search = screen.getByPlaceholderText('Search conversations');
    await user.type(search, 'cached keyword');

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Daily Notes')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Open Project Alpha$/i }));

    expect(await screen.findByText('cached assistant reply')).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.getConversationMessages).toHaveBeenCalledWith('c-1', 'u_001', expect.any(AbortSignal));
    });

    resolveMessages({
      conversation: {
        id: 'c-1',
        user_id: 'u_001',
        title: 'Project Alpha',
        created_at: '2026-04-15T00:00:00.000Z',
        updated_at: '2026-04-15T00:00:00.000Z',
        message_count: 2
      },
      items: [
        { role: 'user', content: 'cached keyword from alpha' },
        { role: 'assistant', content: 'cached assistant reply' }
      ]
    });

    await waitFor(() => {
      expect(cacheMocks.put).toHaveBeenCalled();
    });
  });

  it('creates, renames, selects, and deletes conversations from the sidebar', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('prompt', vi.fn(() => 'Renamed conversation'));
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<App />);
    expect(await screen.findByText('Project Alpha')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /new conversation/i }));
    expect(apiMocks.createConversation).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /^Open New conversation$/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /rename New conversation/i }));
    expect(apiMocks.renameConversation).toHaveBeenCalledWith('c-3', 'u_001', 'Renamed conversation');
    expect(await screen.findByRole('button', { name: /^Open Renamed conversation$/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Open Daily Notes$/i }));
    await waitFor(() => {
      expect(apiMocks.getConversationMessages).toHaveBeenCalledWith('c-2', 'u_001', expect.any(AbortSignal));
    });
    expect(await screen.findByText('You shipped the sidebar.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete Daily Notes/i }));
    await waitFor(() => {
      expect(apiMocks.deleteConversation).toHaveBeenCalledWith('c-2', 'u_001');
    });
    expect(screen.queryByText('Daily Notes')).not.toBeInTheDocument();
  });

  it('revalidates with the server when cached conversation metadata is older than the sidebar conversation', async () => {
    const user = userEvent.setup();

    apiMocks.listConversations.mockResolvedValue({
      items: [
        {
          id: 'c-1',
          user_id: 'u_001',
          title: 'Project Alpha',
          created_at: '2026-04-15T00:00:00.000Z',
          updated_at: '2026-04-15T12:00:00.000Z',
          message_count: 2
        },
        {
          id: 'c-2',
          user_id: 'u_001',
          title: 'Daily Notes',
          created_at: '2026-04-15T00:00:00.000Z',
          updated_at: '2026-04-15T00:00:00.000Z',
          message_count: 1
        }
      ],
      total: 2,
      page: 1,
      page_size: 20
    });

    cacheMocks.get.mockImplementation(async (id: string) => {
      if (id === 'c-1') {
        return {
          conversation: {
            id: 'c-1',
            user_id: 'u_001',
            title: 'Project Alpha',
            created_at: '2026-04-15T00:00:00.000Z',
            updated_at: '2026-04-15T00:00:00.000Z',
            message_count: 2
          },
          messages: [
            { role: 'user', content: 'stale cached question' },
            { role: 'assistant', content: 'stale cached answer' }
          ],
          contentText: 'stale cached question stale cached answer',
          lastViewedAt: 10
        };
      }
      return null;
    });

    apiMocks.getConversationMessages.mockImplementation(async (id: string) => ({
      conversation: {
        id,
        user_id: 'u_001',
        title: 'Project Alpha',
        created_at: '2026-04-15T00:00:00.000Z',
        updated_at: '2026-04-15T12:00:00.000Z',
        message_count: 2
      },
      items: [
        { role: 'user', content: 'fresh server question' },
        { role: 'assistant', content: 'fresh server answer' }
      ]
    }));

    render(<App />);
    expect(await screen.findByText('Project Alpha')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Open Project Alpha$/i }));

    await waitFor(() => {
      expect(apiMocks.getConversationMessages).toHaveBeenCalledWith('c-1', 'u_001', expect.any(AbortSignal));
    });
    expect(await screen.findByText('fresh server answer')).toBeInTheDocument();
    expect(screen.queryByText('stale cached answer')).not.toBeInTheDocument();
  });

  it('shows the latest token usage after sending a message', async () => {
    const user = userEvent.setup();

    render(<App />);
    expect(await screen.findByText('Project Alpha')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Type your prompt...'), 'Explain token usage');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('default streamed reply')).toBeInTheDocument();
    expect(screen.getByText('Context 24 tokens')).toBeInTheDocument();
    expect(screen.getByText('Prompt 12')).toBeInTheDocument();
    expect(screen.getByText('Completion 5')).toBeInTheDocument();
    expect(screen.getByText('Total 17')).toBeInTheDocument();
  });

  it('shows the latest per-user rate limit status after a successful send', async () => {
    const user = userEvent.setup();

    apiMocks.sendNonStream.mockResolvedValue({
      text: 'rate limited but successful reply',
      raw: {
        message: { role: 'assistant', content: 'rate limited but successful reply' },
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        context_tokens_used: 18,
        rate_limit: {
          limit: 60,
          remaining: 59,
          reset_at: new Date(Date.now() + 60_000).toISOString(),
          retry_after_seconds: 0
        }
      }
    });

    render(<App />);
    expect(await screen.findByText('Project Alpha')).toBeInTheDocument();

    await user.click(document.getElementById('mode-select') as HTMLElement);
    await user.click(screen.getByRole('option', { name: /non-stream/i }));
    await user.type(screen.getByPlaceholderText('Type your prompt...'), 'Show rate limit status');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('rate limited but successful reply')).toBeInTheDocument();
    expect(screen.getByText('Rate limit 59/60 left')).toBeInTheDocument();
    expect(screen.getByText(/Resets in about (59|60)s/i)).toBeInTheDocument();
  });

  it('handles 429 responses gracefully with a countdown instead of a raw error blob', async () => {
    const user = userEvent.setup();

    apiMocks.sendNonStream.mockRejectedValue(
      new apiMocks.RateLimitError('Too many requests', 429, {
        limit: 60,
        remaining: 0,
        reset_at: new Date(Date.now() + 12_000).toISOString(),
        retry_after_seconds: 12
      })
    );

    render(<App />);
    expect(await screen.findByText('Project Alpha')).toBeInTheDocument();

    await user.click(document.getElementById('mode-select') as HTMLElement);
    await user.click(screen.getByRole('option', { name: /non-stream/i }));
    await user.type(screen.getByPlaceholderText('Type your prompt...'), 'Trigger a 429');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/Rate limit reached/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Try again in 12s/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Rate limit 0/60 left')).toBeInTheDocument();
    expect(screen.queryByText(/Error:.*Too many requests/i)).not.toBeInTheDocument();
  });
});
