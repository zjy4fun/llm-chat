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
  });

  it('filters conversations by title and cached content, and loads a cache hit without re-fetching', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Daily Notes')).toBeInTheDocument();

    const search = screen.getByPlaceholderText('Search conversations');
    await user.type(search, 'cached keyword');

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Daily Notes')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Open Project Alpha$/i }));

    await waitFor(() => {
      expect(screen.getByText('cached assistant reply')).toBeInTheDocument();
    });
    expect(apiMocks.getConversationMessages).not.toHaveBeenCalledWith('c-1', 'u_001');
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
    expect(await screen.findByText('Renamed conversation')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Open Daily Notes$/i }));
    await waitFor(() => {
      expect(apiMocks.getConversationMessages).toHaveBeenCalledWith('c-2', 'u_001');
    });
    expect(await screen.findByText('You shipped the sidebar.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete Daily Notes/i }));
    await waitFor(() => {
      expect(apiMocks.deleteConversation).toHaveBeenCalledWith('c-2', 'u_001');
    });
    expect(screen.queryByText('Daily Notes')).not.toBeInTheDocument();
  });
});
