import { useState } from 'react';

const initialMessages = [
  {
    role: 'assistant',
    content: 'Send a message to test the mock agent endpoint.',
  },
];

export default function ChatBox() {
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  async function sendMessage(event) {
    event.preventDefault();
    const nextMessage = message.trim();
    if (!nextMessage || isSending) return;

    // 先乐观展示用户消息，再等待后端返回模拟 Agent 回复。
    setMessage('');
    setIsSending(true);
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: 'user', content: nextMessage },
    ]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: nextMessage }),
      });
      if (!response.ok) throw new Error('Chat request failed');
      const data = await response.json();
      setMessages((currentMessages) => [
        ...currentMessages,
        { role: 'assistant', content: data.reply },
      ]);
    } catch (err) {
      setMessages((currentMessages) => [
        ...currentMessages,
        { role: 'assistant', content: err.message },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="mb-6">
        <p className="text-sm text-atoms-muted">Agent Example</p>
        <h2 className="mt-1 text-3xl font-semibold">Chat Agent</h2>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-atoms-line bg-atoms-panel p-5">
        {messages.map((item, index) => (
          <div
            key={`${item.role}-${index}`}
            className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-6 ${
                item.role === 'user'
                  ? 'bg-atoms-accent text-black'
                  : 'bg-white/5 text-atoms-text'
              }`}
            >
              {item.content}
            </div>
          </div>
        ))}
        {isSending ? (
          <div className="text-sm text-atoms-muted">Agent is typing...</div>
        ) : null}
      </div>

      <form onSubmit={sendMessage} className="mt-4 flex gap-3">
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Message the agent"
          className="flex-1 rounded-lg border border-atoms-line bg-atoms-panel px-4 py-3 text-atoms-text outline-none transition placeholder:text-atoms-muted focus:border-atoms-accent"
        />
        <button
          type="submit"
          disabled={isSending}
          className="rounded-lg bg-atoms-accent px-5 py-3 font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </section>
  );
}
