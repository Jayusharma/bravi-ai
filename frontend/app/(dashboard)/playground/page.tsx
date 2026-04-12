'use client';

import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

type Message = { from: string; text: string; timestamp: string };

export default function PlaygroundPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [myId, setMyId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = io('http://localhost:3001', { transports: ['websocket', 'polling'] });

    s.on('connect', () => {
      setIsConnected(true);
      setMyId(s.id || '');
    });
    s.on('disconnect', () => setIsConnected(false));

    // Listen for broadcasted messages
    s.on('new-message', (msg: Message) => {
      setMessages(prev => [...prev, msg]);
    });

    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || !socket) return;
    socket.emit('send-message', { text: input.trim() });
    setInput('');
  };

  const sendPing = () => {
    socket?.emit('ping', { hello: 'server' }, (response: any) => {
      console.log('Pong received:', response);
    });
  };

  return (
    <div style={{ padding: 32, fontFamily: 'monospace', maxWidth: 700 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        ⚡ Level 2: Two-Way Chat
      </h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
        Open this page in two browser tabs to see messages appear in both!
      </p>

      {/* Connection status */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
        padding: '8px 16px', borderRadius: 8,
        background: isConnected ? 'rgba(37,211,102,0.08)' : 'rgba(255,59,48,0.08)',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: isConnected ? '#25d366' : '#ff3b30',
        }} />
        <span style={{ color: isConnected ? '#25d366' : '#ff3b30', fontSize: 13 }}>
          {isConnected ? `Connected (${myId})` : 'Disconnected'}
        </span>
        <button onClick={sendPing} style={{
          marginLeft: 'auto', padding: '4px 12px', borderRadius: 6,
          background: 'rgba(99,102,241,0.15)', color: '#6366f1',
          border: '1px solid rgba(99,102,241,0.3)', cursor: 'pointer', fontSize: 12,
        }}>
          Send Ping 🏓
        </button>
      </div>

      {/* Messages area */}
      <div style={{
        height: 350, overflowY: 'auto', padding: 16, borderRadius: 12,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 && (
          <div style={{ color: '#555', textAlign: 'center', padding: 40 }}>
            No messages yet. Type something below!
          </div>
        )}
        {messages.map((msg, i) => {
          const isMine = msg.from === myId;
          return (
            <div key={i} style={{
              alignSelf: isMine ? 'flex-end' : 'flex-start',
              maxWidth: '70%', padding: '8px 14px', borderRadius: 14,
              background: isMine
                ? 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.2))'
                : 'rgba(255,255,255,0.06)',
              borderBottomRightRadius: isMine ? 4 : 14,
              borderBottomLeftRadius: isMine ? 14 : 4,
            }}>
              <div style={{ fontSize: 13, color: '#e8e8ed' }}>{msg.text}</div>
              <div style={{ fontSize: 10, color: '#666', textAlign: 'right', marginTop: 4 }}>
                {isMine ? 'You' : msg.from.slice(0, 8)} · {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message..."
          style={{
            flex: 1, padding: '10px 16px', borderRadius: 20, fontSize: 14,
            background: 'rgba(255,255,255,0.04)', color: '#e8e8ed',
            border: '1px solid rgba(255,255,255,0.1)', outline: 'none',
          }}
        />
        <button onClick={sendMessage} style={{
          padding: '10px 20px', borderRadius: 20, fontWeight: 600,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14,
        }}>
          Send ➤
        </button>
      </div>
    </div>
  );
}
